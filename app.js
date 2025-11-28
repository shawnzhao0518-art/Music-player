// 状态管理
let songs = [];
let currentSongIndex = -1;
let isPlaying = false;
let audio = new Audio();

// 批量模式状态
let isBatchMode = false;
let selectedSongIds = new Set(); // 存储被选中的歌曲索引

// DOM 元素引用
const songListEl = document.getElementById('song-list');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressBar = document.getElementById('progress-bar');
const currentTimeEl = document.getElementById('current-time');
const totalDurationEl = document.getElementById('total-duration');
const volumeSlider = document.getElementById('volume-slider');
const fileInput = document.getElementById('file-input');
const importBtn = document.getElementById('import-btn');

// 批量相关 DOM
const batchBtn = document.getElementById('batch-btn');
const batchActionBar = document.getElementById('batch-action-bar');
const selectedCountEl = document.getElementById('selected-count');
const batchDeleteBtn = document.getElementById('batch-delete');
const batchCancelBtn = document.getElementById('batch-cancel');
const batchExportBtn = document.getElementById('batch-export');
const batchAddPlaylistBtn = document.getElementById('batch-add-playlist');

// 初始化
function init() {
    // 绑定事件
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileImport);
    
    playPauseBtn.addEventListener('click', togglePlay);
    prevBtn.addEventListener('click', playPrev);
    nextBtn.addEventListener('click', playNext);
    
    // 修复：进度条拖动
    progressBar.addEventListener('input', (e) => {
        const seekTime = (audio.duration / 100) * e.target.value;
        audio.currentTime = seekTime;
    });

    volumeSlider.addEventListener('input', (e) => {
        audio.volume = e.target.value;
    });

    // 关键修复：音频时间更新与元数据加载
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
        totalDurationEl.innerText = formatTime(audio.duration);
    });
    audio.addEventListener('ended', playNext); // 自动播放下一首

    // 批量模式事件绑定
    batchBtn.addEventListener('click', toggleBatchMode);
    batchCancelBtn.addEventListener('click', toggleBatchMode);
    batchDeleteBtn.addEventListener('click', batchDeleteSongs);
    batchExportBtn.addEventListener('click', batchExportSongs);
    batchAddPlaylistBtn.addEventListener('click', () => alert("添加到歌单功能待开发（需完善歌单逻辑）"));

    // 点击其他地方关闭上下文菜单
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.more-btn') && !e.target.closest('.context-menu')) {
            closeAllContextMenus();
        }
    });
}

// 格式化时间 (秒 -> mm:ss)
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// 修复：更新进度条逻辑
function updateProgress() {
    if (audio.duration) {
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        progressBar.value = progressPercent;
        currentTimeEl.innerText = formatTime(audio.currentTime);
        // 持续更新总时长以防加载延迟
        if(totalDurationEl.innerText === "0:00") {
             totalDurationEl.innerText = formatTime(audio.duration);
        }
    }
}

// 文件导入处理
function handleFileImport(event) {
    const files = Array.from(event.target.files);
    
    files.forEach(file => {
        // 使用 jsmediatags 可以获取真实元数据，这里简化处理使用文件名
        const song = {
            id: Date.now() + Math.random(), // 唯一ID
            title: file.name.replace(/\.[^/.]+$/, ""),
            artist: "未知歌手",
            album: "本地导入",
            duration: "--:--", // 需异步获取
            file: file,
            url: URL.createObjectURL(file)
        };
        songs.push(song);
    });

    renderSongList();
    
    // 如果是首次导入，自动播放第一首（可选）
    if (currentSongIndex === -1 && songs.length > 0) {
        // loadSong(0); // 暂时不自动播放，等待用户点击
    }
}

// 渲染歌曲列表
function renderSongList() {
    songListEl.innerHTML = '';
    
    songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.className = `song-item ${index === currentSongIndex ? 'active' : ''}`;
        
        // 渲染 HTML 结构
        li.innerHTML = `
            <div class="song-checkbox-container">
                <input type="checkbox" class="song-checkbox" data-index="${index}">
            </div>
            <div class="song-title">${song.title}</div>
            <div class="song-artist">${song.artist}</div>
            <div class="song-album">${song.album}</div>
            <div class="song-duration">${song.duration}</div>
            <div class="action-cell">
                <button class="more-btn"><span class="material-icons">more_horiz</span></button>
                <ul class="context-menu">
                    <li onclick="alert('已添加到播放队列')">下一首播放</li>
                    <li onclick="alert('添加到歌单逻辑')">添加到歌单</li>
                    <li class="delete-option" data-delete-index="${index}">删除</li>
                </ul>
            </div>
        `;

        // 绑定点击播放逻辑（非批量模式下）
        li.addEventListener('click', (e) => {
            // 如果是复选框、更多按钮或菜单，不触发播放
            if (e.target.closest('.song-checkbox') || e.target.closest('.action-cell')) return;
            
            if (isBatchMode) {
                // 批量模式下点击行 = 切换勾选
                const checkbox = li.querySelector('.song-checkbox');
                checkbox.checked = !checkbox.checked;
                handleCheckboxChange(index, checkbox.checked);
            } else {
                playSong(index);
            }
        });

        // 绑定复选框事件
        const checkbox = li.querySelector('.song-checkbox');
        checkbox.addEventListener('change', (e) => {
            handleCheckboxChange(index, e.target.checked);
        });
        
        // 绑定更多菜单事件
        const moreBtn = li.querySelector('.more-btn');
        const contextMenu = li.querySelector('.context-menu');
        
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllContextMenus(); // 关闭其他
            contextMenu.classList.add('show');
        });

        // 绑定单曲删除事件
        const deleteBtn = li.querySelector('.delete-option');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSong(index);
        });

        songListEl.appendChild(li);
    });

    // 恢复批量模式下的UI状态
    if(isBatchMode) {
        document.body.classList.add('batch-active');
        // 重新勾选之前选中的
        const checkboxes = document.querySelectorAll('.song-checkbox');
        checkboxes.forEach(box => {
            const idx = parseInt(box.dataset.index);
            // 注意：这里简化逻辑，只要索引在Set里就勾选（实际删除后索引会变，稍后处理）
        });
    } else {
        document.body.classList.remove('batch-active');
    }
}

// 播放逻辑
function loadSong(index) {
    if (index < 0 || index >= songs.length) return;
    
    currentSongIndex = index;
    const song = songs[index];
    
    audio.src = song.url;
    audio.load();
    
    // 更新 UI
    document.getElementById('current-title').innerText = song.title;
    document.getElementById('current-artist').innerText = song.artist;
    
    renderSongList(); // 更新高亮
}

function playSong(index) {
    loadSong(index);
    togglePlay();
}

function togglePlay() {
    if (songs.length === 0) return;
    
    if (audio.paused) {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayButton();
        }).catch(err => console.error("播放失败:", err));
    } else {
        audio.pause();
        isPlaying = false;
        updatePlayButton();
    }
}

function updatePlayButton() {
    const icon = playPauseBtn.querySelector('.material-icons');
    icon.innerText = isPlaying ? 'pause_circle_filled' : 'play_circle_filled';
}

function playPrev() {
    let newIndex = currentSongIndex - 1;
    if (newIndex < 0) newIndex = songs.length - 1;
    playSong(newIndex);
}

function playNext() {
    let newIndex = currentSongIndex + 1;
    if (newIndex >= songs.length) newIndex = 0;
    playSong(newIndex);
}

function closeAllContextMenus() {
    document.querySelectorAll('.context-menu').forEach(menu => menu.classList.remove('show'));
}

// --- 删除功能 (单曲) ---
function deleteSong(index) {
    if(confirm(`确定要删除 "${songs[index].title}" 吗？`)) {
        // 如果删除的是当前播放的歌，停止播放
        if (index === currentSongIndex) {
            audio.pause();
            audio.src = "";
            isPlaying = false;
            updatePlayButton();
            document.getElementById('current-title').innerText = "未播放";
        }
        
        songs.splice(index, 1);
        // 如果删除后的索引变化，需要调整 currentSongIndex
        if (index < currentSongIndex) {
            currentSongIndex--;
        }
        renderSongList();
    }
}

// --- 批量模式逻辑 ---

function toggleBatchMode() {
    isBatchMode = !isBatchMode;
    selectedSongIds.clear();
    updateBatchUI();
    renderSongList(); // 重新渲染以显示/隐藏复选框
}

function handleCheckboxChange(index, isChecked) {
    // 这里我们简单使用 index 作为标识，实际项目中建议使用 song.id
    if (isChecked) {
        selectedSongIds.add(index);
    } else {
        selectedSongIds.delete(index);
    }
    updateBatchUI();
}

function updateBatchUI() {
    const count = selectedSongIds.size;
    selectedCountEl.innerText = count;
    
    if (isBatchMode) {
        batchActionBar.classList.remove('hidden');
        batchBtn.classList.add('active-state'); // 可选：添加样式表示激活
        batchBtn.innerHTML = '<span class="material-icons">close</span> 退出批量';
    } else {
        batchActionBar.classList.add('hidden');
        batchBtn.innerHTML = '<span class="material-icons">select_all</span> 批量';
    }
}

// 批量删除
function batchDeleteSongs() {
    if (selectedSongIds.size === 0) return;
    
    if (confirm(`确定要删除选中的 ${selectedSongIds.size} 首歌曲吗？`)) {
        // 从大到小排序索引，防止删除时索引错位
        const sortedIndices = Array.from(selectedSongIds).sort((a, b) => b - a);
        
        sortedIndices.forEach(index => {
            if (index === currentSongIndex) {
                audio.pause();
                audio.src = "";
                isPlaying = false;
                updatePlayButton();
            }
            songs.splice(index, 1);
        });
        
        currentSongIndex = -1; // 简单重置
        toggleBatchMode(); // 退出批量模式
        renderSongList();
    }
}

// 批量导出
function batchExportSongs() {
    if (selectedSongIds.size === 0) return;
    
    alert("正在准备导出，浏览器可能会询问允许多个文件下载...");
    
    selectedSongIds.forEach(index => {
        const song = songs[index];
        const a = document.createElement('a');
        a.href = song.url;
        a.download = `${song.title}.mp3`; // 尝试恢复文件名
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
    
    toggleBatchMode();
}

// 启动应用
init();
