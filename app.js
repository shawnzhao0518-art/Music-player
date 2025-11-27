/* * app.js - Web Music Player Core Logic (With IndexedDB Persistence)
 * 功能：状态管理、音频播放、播放列表操作、拖拽排序、UI渲染、本地数据库存储
 */

// ==========================================
// 0. IndexedDB 数据库管理 (持久化存储核心)
// ==========================================
const dbName = "WebMusicPlayerDB";
const storeName = "songs";
let db;

const MusicDB = {
    init: () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: "id" });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                console.log("Database initialized");
                resolve(db);
            };

            request.onerror = (event) => {
                console.error("Database error", event);
                reject("DB Error");
            };
        });
    },

    addSong: (song) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.add(song); // 存储整个对象（包含文件Blob）
            
            request.onsuccess = () => resolve(song);
            request.onerror = (e) => reject(e);
        });
    },

    getAllSongs: () => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readonly");
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e);
        });
    },

    deleteSong: (id) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
        });
    },
    
    clearAll: () => {
        const transaction = db.transaction([storeName], "readwrite");
        transaction.objectStore(storeName).clear();
    }
};

// ==========================================
// 1. 全局状态 (State Management)
// ==========================================
const state = {
    allSongs: [],           // 存储所有歌曲对象
    playlists: [            // 播放列表数组
        { id: 'fav', name: '我的最爱', songIds: [] }
    ],
    history: [],            
    
    currentView: 'all-songs', 
    currentPlaylist: [],      
    currentSongIndex: -1,     
    
    isPlaying: false,
    mode: 'sequence',         
    volume: 1,
    
    dragStartIndex: null      
};

// 核心音频对象
const audio = new Audio();

// ==========================================
// 2. 初始化与事件监听 (Init & Listeners)
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. 初始化数据库
    await MusicDB.init();

    // 2. 从数据库加载之前的歌曲
    const savedSongs = await MusicDB.getAllSongs();
    if (savedSongs && savedSongs.length > 0) {
        state.allSongs = savedSongs;
        console.log(`Loaded ${savedSongs.length} songs from storage.`);
    }

    // 3. 恢复播放列表结构
    loadPlaylists();
    
    // 4. 渲染 UI
    renderSidebar();
    renderSongList();
    updateUIState();
    
    // 音频事件绑定
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', handleSongEnd);
    audio.addEventListener('loadedmetadata', () => {
        const duration = audio.duration;
        document.getElementById('total-duration').innerText = formatTime(duration);
        document.getElementById('seek-bar').max = duration;
        
        // 可选：更新当前播放歌曲的时长到数据库（如果之前是0）
        // updateSongDurationInDB(...)
    });
    audio.addEventListener('error', (e) => {
        console.error("Audio error", e);
        // 如果出错不自动切歌，避免死循环
    });
});

// ==========================================
// 3. 文件处理与导入 (File Handling)
// ==========================================
async function handleFiles(files) {
    if (!files.length) return;

    const titleElem = document.getElementById('view-title');
    const originalTitle = titleElem.innerText;
    titleElem.innerText = "正在导入并保存..."; // 提示用户正在存库

    for (let file of files) {
        const songId = 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 基础元数据
        let song = {
            id: songId,
            file: file, // 这是一个 Blob/File 对象，IndexedDB 支持直接存储它
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: '未知艺人',
            album: '未知专辑',
            duration: 0,
            dateAdded: Date.now()
        };

        // 读取 ID3 (可选)
        if (window.jsmediatags) {
            try {
                await new Promise((resolve) => {
                    window.jsmediatags.read(file, {
                        onSuccess: (tag) => {
                            const tags = tag.tags;
                            if (tags.title) song.title = tags.title;
                            if (tags.artist) song.artist = tags.artist;
                            if (tags.album) song.album = tags.album;
                            resolve();
                        },
                        onError: () => resolve()
                    });
                });
            } catch (e) { console.log('Tag read error', e); }
        }

        // 保存到内存
        state.allSongs.push(song);
        // 保存到数据库 (持久化)
        MusicDB.addSong(song).catch(e => console.error("Save failed", e));
    }

    titleElem.innerText = originalTitle;
    
    if (state.currentView === 'all-songs') {
        renderSongList();
    }
    updateUIState();
}

// 辅助：更新侧边栏等状态（如果有）
function updateUIState() {
    // 可以在这里更新侧边栏的计数等
}

// ==========================================
// 4. 核心播放逻辑 (Playback Logic)
// ==========================================

function playSongById(id) {
    const song = state.allSongs.find(s => s.id === id);
    if (!song) return;

    setupQueueBasedOnView();
    state.currentSongIndex = state.currentPlaylist.findIndex(s => s.id === id);
    loadAndPlay(song);
}

function setupQueueBasedOnView() {
    state.currentPlaylist = getCurrentViewSongs();
}

function loadAndPlay(song) {
    if (!song.file) {
        alert("文件数据丢失");
        return;
    }

    // 释放之前的 URL 以节省内存
    if (audio.src && audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
    }

    // 从 Blob 创建播放 URL
    const fileURL = URL.createObjectURL(song.file);
    audio.src = fileURL;
    audio.play()
        .then(() => { state.isPlaying = true; updatePlayButtonIcon(); })
        .catch(e => { console.error("Play failed", e); state.isPlaying = false; updatePlayButtonIcon(); });

    updatePlayerBar(song);
    addToHistory(song.id);
    highlightActiveSong(song.id);
}

function togglePlay() {
    if (!audio.src) {
        if (state.allSongs.length > 0) playSongById(state.allSongs[0].id);
        return;
    }

    if (state.isPlaying) {
        audio.pause();
        state.isPlaying = false;
    } else {
        audio.play();
        state.isPlaying = true;
    }
    updatePlayButtonIcon();
}

function playNext() {
    if (state.currentPlaylist.length === 0) return;

    let nextIndex;
    if (state.mode === 'shuffle') {
        nextIndex = Math.floor(Math.random() * state.currentPlaylist.length);
    } else {
        nextIndex = state.currentSongIndex + 1;
        if (nextIndex >= state.currentPlaylist.length) {
            nextIndex = 0; 
        }
    }

    state.currentSongIndex = nextIndex;
    loadAndPlay(state.currentPlaylist[nextIndex]);
}

function playPrev() {
    if (state.currentPlaylist.length === 0) return;
    
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }

    let prevIndex = state.currentSongIndex - 1;
    if (prevIndex < 0) prevIndex = state.currentPlaylist.length - 1;
    
    state.currentSongIndex = prevIndex;
    loadAndPlay(state.currentPlaylist[prevIndex]);
}

function handleSongEnd() {
    if (state.mode === 'one') {
        audio.currentTime = 0;
        audio.play();
    } else {
        playNext();
    }
}

function toggleMode() {
    const modes = ['sequence', 'shuffle', 'one'];
    const icons = {
        'sequence': 'fa-repeat',
        'shuffle': 'fa-shuffle',
        'one': 'fa-1' 
    };
    
    let currentIdx = modes.indexOf(state.mode);
    let nextIdx = (currentIdx + 1) % modes.length;
    state.mode = modes[nextIdx];
    
    const btn = document.getElementById('mode-btn');
    btn.innerHTML = `<i class="fa-solid ${icons[state.mode]}"></i>`;
    
    if (state.mode !== 'sequence') {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

// ==========================================
// 5. UI 渲染与交互 (UI Rendering)
// ==========================================

function getCurrentViewSongs() {
    let songs = [];
    if (state.currentView === 'all-songs') {
        songs = state.allSongs;
    } else if (state.currentView === 'recent') {
        songs = state.history.map(id => state.allSongs.find(s => s.id === id)).filter(s => s);
    } else {
        const playlist = state.playlists.find(p => p.id === state.currentView);
        if (playlist) {
            songs = playlist.songIds.map(id => state.allSongs.find(s => s.id === id)).filter(s => s);
        }
    }
    
    const keyword = document.getElementById('search-input').value.toLowerCase();
    if (keyword) {
        songs = songs.filter(s => s.title.toLowerCase().includes(keyword) || s.artist.toLowerCase().includes(keyword));
    }
    
    return songs;
}

function renderSongList() {
    const listContainer = document.getElementById('song-list');
    const songs = getCurrentViewSongs();
    
    const countSpan = document.getElementById('song-count');
    countSpan.innerText = `${songs.length} 首歌`;
    
    if (songs.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-music"></i>
                <p>这里没有歌曲</p>
                <button class="btn-secondary" onclick="deleteAllSongs()" style="margin-top:10px;">清空数据库</button>
            </div>`;
        return;
    }

    listContainer.innerHTML = ''; 

    songs.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'song-item';
        
        if (state.currentView !== 'all-songs' && state.currentView !== 'recent') {
            row.setAttribute('draggable', 'true');
            row.addEventListener('dragstart', (e) => handleDragStart(e, index));
            row.addEventListener('dragover', handleDragOver);
            row.addEventListener('drop', (e) => handleDrop(e, index));
            row.addEventListener('dragend', handleDragEnd);
        }
        
        row.ondblclick = () => playSongById(song.id);
        
        // 移动端/iPad 单击也播放（优化体验）
        // 简单区分：如果屏幕小，或者想支持单击切歌
        // row.onclick = () => playSongById(song.id); 

        if (state.allSongs[state.currentSongIndex] && state.allSongs[state.currentSongIndex].id === song.id) {
            row.classList.add('active');
        }

        row.innerHTML = `
            <div class="col-index">${index + 1}</div>
            <div class="col-title" title="${song.title}">${song.title}</div>
            <div class="col-artist">${song.artist}</div>
            <div class="col-album">${song.album}</div>
            <div class="col-time">${song.duration ? formatTime(song.duration) : '--:--'}</div>
            <div class="col-actions">
                <button onclick="openAddToPlaylistModal('${song.id}')" title="添加到播放列表">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <button onclick="removeSong('${song.id}')" title="删除">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        listContainer.appendChild(row);
    });
}

function renderSidebar() {
    const container = document.getElementById('playlist-container');
    container.innerHTML = '';
    
    state.playlists.forEach(pl => {
        const li = document.createElement('li');
        li.className = 'menu-item';
        if (state.currentView === pl.id) li.classList.add('active');
        
        li.onclick = (e) => {
            if (e.target.closest('.delete-playlist-btn')) return;
            switchView(pl.id);
        };
        
        li.innerHTML = `
            <i class="fa-solid fa-list"></i> ${pl.name}
            <i class="fa-solid fa-trash delete-playlist-btn" onclick="deletePlaylist('${pl.id}')" title="删除列表"></i>
        `;
        container.appendChild(li);
    });
}

function switchView(viewId) {
    state.currentView = viewId;
    
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    if (viewId === 'all-songs' || viewId === 'recent') {
        document.querySelector(`[data-view="${viewId}"]`).classList.add('active');
        document.getElementById('view-title').innerText = viewId === 'all-songs' ? '全部歌曲' : '最近播放';
    } else {
        const pl = state.playlists.find(p => p.id === viewId);
        if (pl) document.getElementById('view-title').innerText = pl.name;
        renderSidebar(); 
    }
    
    renderSongList();
}

function updatePlayerBar(song) {
    document.getElementById('current-name').innerText = song.title;
    document.getElementById('current-artist').innerText = song.artist;
    // 封面暂时略
    document.getElementById('current-cover').innerHTML = `<i class="fa-solid fa-compact-disc" style="font-size:24px"></i>`;
}

function updatePlayButtonIcon() {
    const btn = document.getElementById('play-pause-btn');
    btn.innerHTML = state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function highlightActiveSong(songId) {
    renderSongList();
}

function handleSearch(val) {
    renderSongList();
}

function sortSongs(field) {
    // 简单排序，不影响数据库，只影响 allSongs 内存顺序
    state.allSongs.sort((a, b) => {
        if (a[field] > b[field]) return 1;
        if (a[field] < b[field]) return -1;
        return 0;
    });
    renderSongList();
}

// ==========================================
// 6. 播放列表与数据管理
// ==========================================

function createPlaylist() {
    const name = prompt("请输入播放列表名称", "新建列表");
    if (!name) return;
    
    const newPl = {
        id: 'pl_' + Date.now(),
        name: name,
        songIds: []
    };
    state.playlists.push(newPl);
    savePlaylists();
    renderSidebar();
}

function deletePlaylist(id) {
    if (!confirm("确定删除此播放列表吗？")) return;
    state.playlists = state.playlists.filter(p => p.id !== id);
    if (state.currentView === id) switchView('all-songs');
    savePlaylists();
    renderSidebar();
}

// 删除单个歌曲
function removeSong(id) {
    if (!confirm("确定从库中删除这首歌吗？")) return;
    
    // 1. 内存删除
    state.allSongs = state.allSongs.filter(s => s.id !== id);
    state.playlists.forEach(pl => {
        pl.songIds = pl.songIds.filter(sid => sid !== id);
    });
    state.history = state.history.filter(sid => sid !== id);
    
    // 2. 数据库删除
    MusicDB.deleteSong(id);
    
    savePlaylists();
    renderSongList();
}

// 开发者功能：清空所有数据
function deleteAllSongs() {
    if(confirm("确定清空所有本地存储的音乐吗？")) {
        MusicDB.clearAll();
        state.allSongs = [];
        state.playlists.forEach(p => p.songIds = []);
        state.history = [];
        savePlaylists();
        renderSongList();
    }
}

// 模态框逻辑
let songToAddId = null;
function openAddToPlaylistModal(songId) {
    songToAddId = songId;
    const modal = document.getElementById('modal-add-to-playlist');
    const list = document.getElementById('modal-playlist-list');
    list.innerHTML = '';
    
    state.playlists.forEach(pl => {
        const li = document.createElement('li');
        li.innerText = pl.name;
        li.onclick = () => {
            pl.songIds.push(songToAddId);
            savePlaylists();
            closeModal();
            alert(`已添加到 ${pl.name}`);
        };
        list.appendChild(li);
    });
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-add-to-playlist').classList.add('hidden');
}

function savePlaylists() {
    localStorage.setItem('myMusic_playlists', JSON.stringify(state.playlists));
}

function loadPlaylists() {
    const data = localStorage.getItem('myMusic_playlists');
    if (data) {
        state.playlists = JSON.parse(data);
    }
}

function addToHistory(songId) {
    state.history = state.history.filter(id => id !== songId);
    state.history.unshift(songId);
    if (state.history.length > 50) state.history.pop();
}

// ==========================================
// 7. 拖拽排序 (Drag & Drop)
// ==========================================
function handleDragStart(e, index) {
    state.dragStartIndex = index;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e, dropIndex) {
    e.preventDefault();
    const startIndex = state.dragStartIndex;
    
    if (startIndex === null || startIndex === dropIndex) return;

    const playlist = state.playlists.find(p => p.id === state.currentView);
    if (!playlist) return; 
    
    const list = playlist.songIds;
    const [movedItem] = list.splice(startIndex, 1);
    list.splice(dropIndex, 0, movedItem);
    
    savePlaylists();
    renderSongList();
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    state.dragStartIndex = null;
}

// ==========================================
// 8. 辅助函数 (Utils)
// ==========================================
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function updateProgress() {
    const current = audio.currentTime;
    const duration = audio.duration;
    document.getElementById('seek-bar').value = current;
    document.getElementById('current-time').innerText = formatTime(current);
}

function handleSeek(val) {
    audio.currentTime = val;
}

function handleVolume(val) {
    audio.volume = val;
    state.volume = val;
    const icon = document.getElementById('vol-icon');
    if (val == 0) icon.className = "fa-solid fa-volume-xmark";
    else if (val < 0.5) icon.className = "fa-solid fa-volume-low";
    else icon.className = "fa-solid fa-volume-high";
}

function toggleMute() {
    if (audio.volume > 0) {
        audio.volume = 0;
        document.getElementById('volume-bar').value = 0;
    } else {
        audio.volume = state.volume || 1;
        document.getElementById('volume-bar').value = state.volume || 1;
    }
}
