/* * app.js - Web Music Player Core Logic
 * 功能：状态管理、音频播放、播放列表操作、拖拽排序、UI渲染
 */

// ==========================================
// 1. 全局状态 (State Management)
// ==========================================
const state = {
    allSongs: [],           // 存储所有导入的歌曲对象: { id, file, title, artist, album, duration, cover }
    playlists: [            // 播放列表数组
        { id: 'fav', name: '我的最爱', songIds: [] }
    ],
    history: [],            // 历史播放记录 (Song IDs)
    
    currentView: 'all-songs', // 当前视图: 'all-songs', 'recent', 或 playlist ID
    currentPlaylist: [],      // 当前正在播放的队列 (Song Objects)
    currentSongIndex: -1,     // 当前播放歌曲在队列中的索引
    
    isPlaying: false,
    mode: 'sequence',         // 播放模式: 'sequence' (顺序), 'shuffle' (随机), 'one' (单曲)
    volume: 1,
    
    dragStartIndex: null      // 拖拽排序起始索引
};

// 核心音频对象
const audio = new Audio();

// ==========================================
// 2. 初始化与事件监听 (Init & Listeners)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 恢复数据 (可选：从 localStorage 恢复播放列表结构)
    loadPlaylists();
    
    // 渲染 UI
    renderSidebar();
    renderSongList();
    
    // 音频事件绑定
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', handleSongEnd);
    audio.addEventListener('loadedmetadata', () => {
        document.getElementById('total-duration').innerText = formatTime(audio.duration);
        document.getElementById('seek-bar').max = audio.duration;
    });
    audio.addEventListener('error', (e) => {
        console.error("Audio error", e);
        // 如果出错自动播下一首
        setTimeout(playNext, 1000); 
    });
});

// ==========================================
// 3. 文件处理与导入 (File Handling)
// ==========================================
async function handleFiles(files) {
    if (!files.length) return;

    // 显示加载状态（简单处理）
    const titleElem = document.getElementById('view-title');
    const originalTitle = titleElem.innerText;
    titleElem.innerText = "正在分析音频...";

    for (let file of files) {
        // 简单 ID 生成
        const songId = 'song_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 默认元数据
        let song = {
            id: songId,
            file: file, // 注意：File 对象在页面刷新后会失效，这是纯前端限制
            title: file.name.replace(/\.[^/.]+$/, ""), // 去除后缀作为标题
            artist: '未知艺人',
            album: '未知专辑',
            duration: 0,
            cover: null
        };

        // 尝试读取 ID3 信息 (如果有 jsmediatags 库)
        if (window.jsmediatags) {
            try {
                await new Promise((resolve) => {
                    window.jsmediatags.read(file, {
                        onSuccess: (tag) => {
                            const tags = tag.tags;
                            if (tags.title) song.title = tags.title;
                            if (tags.artist) song.artist = tags.artist;
                            if (tags.album) song.album = tags.album;
                            // 封面读取略微复杂，这里暂略，需要转 base64
                            resolve();
                        },
                        onError: (error) => {
                            resolve(); // 失败也继续
                        }
                    });
                });
            } catch (e) { console.log('Tag read error', e); }
        }

        // 获取时长（创建临时 Audio 对象）
        // 为了性能，如果不强制预加载时长，可以在播放时更新。
        // 这里简单略过，设为 0，播放时会自动显示。
        
        state.allSongs.push(song);
    }

    titleElem.innerText = originalTitle;
    
    // 如果当前视图是 "全部歌曲"，刷新列表
    if (state.currentView === 'all-songs') {
        renderSongList();
    }
    
    // 更新侧边栏数量等
    updateUIState();
}

// ==========================================
// 4. 核心播放逻辑 (Playback Logic)
// ==========================================

// 播放指定歌曲 (根据 ID)
function playSongById(id) {
    const song = state.allSongs.find(s => s.id === id);
    if (!song) return;

    // 1. 设置当前播放队列逻辑
    // 如果是在 "全部歌曲" 视图点击，队列就是 state.allSongs
    // 如果是在 "播放列表" 视图点击，队列就是该播放列表的歌曲
    // 这里简化：点击哪里，就把当前视图的所有歌曲作为播放队列
    setupQueueBasedOnView();

    // 2. 找到该歌在队列中的 Index
    state.currentSongIndex = state.currentPlaylist.findIndex(s => s.id === id);

    // 3. 执行播放
    loadAndPlay(song);
}

// 根据当前视图设置播放队列
function setupQueueBasedOnView() {
    state.currentPlaylist = getCurrentViewSongs();
}

// 加载音频源并播放
function loadAndPlay(song) {
    if (!song.file) {
        alert("文件已失效（页面刷新导致），请重新导入。");
        return;
    }

    // 使用 Blob URL 播放本地文件
    const fileURL = URL.createObjectURL(song.file);
    audio.src = fileURL;
    audio.play();
    state.isPlaying = true;

    // 更新 UI
    updatePlayerBar(song);
    addToHistory(song.id);
    highlightActiveSong(song.id);
    updatePlayButtonIcon();

    // 清理旧的 Blob URL (可选优化，简单版略过)
}

function togglePlay() {
    if (!audio.src) {
        // 如果没有正在播放的，且有歌，播放第一首
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
        // 随机模式：简单随机取一个非当前的索引
        nextIndex = Math.floor(Math.random() * state.currentPlaylist.length);
    } else {
        // 顺序模式
        nextIndex = state.currentSongIndex + 1;
        if (nextIndex >= state.currentPlaylist.length) {
            nextIndex = 0; // 循环回到开头
        }
    }

    state.currentSongIndex = nextIndex;
    loadAndPlay(state.currentPlaylist[nextIndex]);
}

function playPrev() {
    if (state.currentPlaylist.length === 0) return;
    
    // 如果播放超过3秒，点击上一首通常是重头开始
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }

    let prevIndex = state.currentSongIndex - 1;
    if (prevIndex < 0) prevIndex = state.currentPlaylist.length - 1;
    
    state.currentSongIndex = prevIndex;
    loadAndPlay(state.currentPlaylist[prevIndex]);
}

// 歌曲结束时的处理
function handleSongEnd() {
    if (state.mode === 'one') {
        audio.currentTime = 0;
        audio.play();
    } else {
        playNext();
    }
}

// 切换播放模式
function toggleMode() {
    const modes = ['sequence', 'shuffle', 'one'];
    const icons = {
        'sequence': 'fa-repeat', // 实际上 sequence 图标通常是默认状态，这里用 repeat 表示列表循环
        'shuffle': 'fa-shuffle',
        'one': 'fa-1' // 需要 FontAwesome 6
    };
    
    let currentIdx = modes.indexOf(state.mode);
    let nextIdx = (currentIdx + 1) % modes.length;
    state.mode = modes[nextIdx];
    
    // 更新图标和高亮
    const btn = document.getElementById('mode-btn');
    btn.innerHTML = `<i class="fa-solid ${icons[state.mode]}"></i>`;
    
    // 高亮状态
    if (state.mode !== 'sequence') {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
}

// ==========================================
// 5. UI 渲染与交互 (UI Rendering)
// ==========================================

// 获取当前视图应该显示的歌曲数组
function getCurrentViewSongs() {
    let songs = [];
    if (state.currentView === 'all-songs') {
        songs = state.allSongs;
    } else if (state.currentView === 'recent') {
        songs = state.history.map(id => state.allSongs.find(s => s.id === id)).filter(s => s);
    } else {
        // 具体的播放列表
        const playlist = state.playlists.find(p => p.id === state.currentView);
        if (playlist) {
            songs = playlist.songIds.map(id => state.allSongs.find(s => s.id === id)).filter(s => s);
        }
    }
    
    // 搜索过滤
    const keyword = document.getElementById('search-input').value.toLowerCase();
    if (keyword) {
        songs = songs.filter(s => s.title.toLowerCase().includes(keyword) || s.artist.toLowerCase().includes(keyword));
    }
    
    return songs;
}

function renderSongList() {
    const listContainer = document.getElementById('song-list');
    const songs = getCurrentViewSongs();
    
    // 更新标题和数量
    const countSpan = document.getElementById('song-count');
    countSpan.innerText = `${songs.length} 首歌`;
    
    if (songs.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-music"></i>
                <p>这里没有歌曲</p>
            </div>`;
        return;
    }

    listContainer.innerHTML = ''; // 清空

    songs.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'song-item';
        // 拖拽属性
        if (state.currentView !== 'all-songs' && state.currentView !== 'recent') {
            row.setAttribute('draggable', 'true');
            row.addEventListener('dragstart', (e) => handleDragStart(e, index));
            row.addEventListener('dragover', handleDragOver);
            row.addEventListener('drop', (e) => handleDrop(e, index));
            row.addEventListener('dragend', handleDragEnd);
        }
        
        // 双击播放
        row.ondblclick = () => playSongById(song.id);
        // 单击高亮 (这里简单做，实际可以做选中态)
        
        // 检查是否是当前播放
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
            // 防止触发内部按钮
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
    
    // 更新 Sidebar 高亮
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    if (viewId === 'all-songs' || viewId === 'recent') {
        document.querySelector(`[data-view="${viewId}"]`).classList.add('active');
        document.getElementById('view-title').innerText = viewId === 'all-songs' ? '全部歌曲' : '最近播放';
    } else {
        const pl = state.playlists.find(p => p.id === viewId);
        if (pl) document.getElementById('view-title').innerText = pl.name;
        renderSidebar(); // 重新渲染列表以更新高亮
    }
    
    renderSongList();
}

function updatePlayerBar(song) {
    document.getElementById('current-name').innerText = song.title;
    document.getElementById('current-artist').innerText = song.artist;
    // 简单封面占位
    document.getElementById('current-cover').innerHTML = `<i class="fa-solid fa-compact-disc" style="font-size:24px"></i>`;
}

function updatePlayButtonIcon() {
    const btn = document.getElementById('play-pause-btn');
    btn.innerHTML = state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function highlightActiveSong(songId) {
    // 简单重绘整个列表保持状态同步
    renderSongList();
}

function handleSearch(val) {
    renderSongList();
}

function sortSongs(field) {
    // 简单的本地排序
    // 注意：如果是播放列表中排序，应该改变 playlist.songIds 的顺序并保存
    // 这里为了演示，仅对当前视图的数组排序（不做持久化）
    alert("演示版：仅支持视图排序，未改变播放顺序");
}

// ==========================================
// 6. 播放列表管理 (Playlists)
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
    // 持久化播放列表结构到 localStorage
    // 注意：无法持久化 file 对象，所以刷新页面后列表还在，但内容需要重新匹配（这里简化版不处理重新匹配）
    localStorage.setItem('myMusic_playlists', JSON.stringify(state.playlists));
}

function loadPlaylists() {
    const data = localStorage.getItem('myMusic_playlists');
    if (data) {
        state.playlists = JSON.parse(data);
    }
}

function addToHistory(songId) {
    // 移除已存在的，添加到开头
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
    e.preventDefault(); // 必须阻止默认行为才能 Drop
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e, dropIndex) {
    e.preventDefault();
    const startIndex = state.dragStartIndex;
    
    if (startIndex === null || startIndex === dropIndex) return;

    // 获取当前播放列表对象
    const playlist = state.playlists.find(p => p.id === state.currentView);
    if (!playlist) return; // 只允许在自定义播放列表中排序
    
    // 移动数组元素
    const list = playlist.songIds;
    const [movedItem] = list.splice(startIndex, 1);
    list.splice(dropIndex, 0, movedItem);
    
    // 保存并重绘
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
    
    // 进度条背景处理 (类似 Webkit 样式 hack)
    // 略
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
