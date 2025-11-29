// 全局状态
let songs = [];
let currentIndex = -1;
let isPlaying = false;
let isBatchMode = false;
let selectedSet = new Set(); // 存储选中歌曲的索引
const audio = new Audio();

// DOM 元素引用
const els = {
    list: document.getElementById('song-list'),
    fileInput: document.getElementById('file-input'),
    importBtn: document.getElementById('import-btn'),
    playBtn: document.getElementById('play-pause-btn'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    progress: document.getElementById('progress-bar'),
    currTime: document.getElementById('current-time'),
    totalTime: document.getElementById('total-duration'),
    cover: document.getElementById('album-cover'),
    title: document.getElementById('current-title'),
    artist: document.getElementById('current-artist'),
    vol: document.getElementById('volume-slider'),
    countLabel: document.getElementById('song-count-label'),
    // 批量相关
    batchToggle: document.getElementById('batch-toggle-btn'),
    batchBar: document.getElementById('batch-bar'),
    selCount: document.getElementById('selected-count'),
    batchDel: document.getElementById('batch-delete-btn'),
    batchExport: document.getElementById('batch-export-btn'),
    batchCancel: document.getElementById('batch-cancel-btn')
};

function init() {
    // 基础播放事件
    els.importBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', handleImport);
    els.playBtn.addEventListener('click', togglePlay);
    els.prevBtn.addEventListener('click', playPrev);
    els.nextBtn.addEventListener('click', playNext);
    els.vol.addEventListener('input', (e) => audio.volume = e.target.value);

    // --- 核心修复：进度条逻辑 ---
    // 1. 拖动进度条跳转
    els.progress.addEventListener('input', (e) => {
        const val = e.target.value;
        if(audio.duration) {
            audio.currentTime = (val / 100) * audio.duration;
        }
    });
    // 2. 监听时间更新，走动进度条
    audio.addEventListener('timeupdate', () => {
        if(!audio.duration) return;
        els.currTime.innerText = formatTime(audio.currentTime);
        const percent = (audio.currentTime / audio.duration) * 100;
        els.progress.value = percent;
    });
    // 3. 加载元数据，显示总时长
    audio.addEventListener('loadedmetadata', () => {
        els.totalTime.innerText = formatTime(audio.duration);
    });
    // 4. 自动连播
    audio.addEventListener('ended', playNext);

    // --- 批量模式逻辑 ---
    els.batchToggle.addEventListener('click', toggleBatchMode);
    els.batchCancel.addEventListener('click', toggleBatchMode);
    els.batchDel.addEventListener('click', batchDelete);
    els.batchExport.addEventListener('click', batchExport);

    // 点击空白处关闭菜单
    document.addEventListener('click', (e) => {
        if(!e.target.closest('.song-actions')) {
            document.querySelectorAll('.context-menu').forEach(m => m.classList.remove('show'));
        }
    });
}

function formatTime(s) {
    if(isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec<10?'0':''}${sec}`;
}

function handleImport(e) {
    const files = Array.from(e.target.files);
    files.forEach(f => {
        songs.push({
            id: Date.now() + Math.random(),
            name: f.name.replace(/\.[^/.]+$/, ""),
            artist: "未知艺人",
            album: "本地导入",
            url: URL.createObjectURL(f),
            duration: "--:--"
        });
    });
    renderList();
}

function renderList() {
    els.list.innerHTML = "";
    els.countLabel.innerText = `${songs.length} 首歌`;

    songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.className = `song-item ${index === currentIndex ? 'active' : ''}`;
        
        li.innerHTML = `
            <div class="check-wrap">
                <span class="track-idx">${index + 1}</span>
                <input type="checkbox" class="batch-checkbox" data-idx="${index}" 
                    ${selectedSet.has(index) ? 'checked' : ''}>
            </div>
            <div class="col-name" style="font-weight:500;">${song.name}</div>
            <div class="col-artist">${song.artist}</div>
            <div class="col-album">${song.album}</div>
            <div class="col-time">${song.duration}</div>
            <div class="song-actions">
                <button class="more-btn"><span class="material-icons">more_horiz</span></button>
                <div class="context-menu">
                    <div class="menu-item" onclick="playSong(${index})"><span class="material-icons">play_arrow</span> 播放</div>
                    <div class="menu-item" onclick="alert('已添加到播放队列')"><span class="material-icons">queue_music</span> 下一首播放</div>
                    <div class="menu-item danger delete-one" data-idx="${index}"><span class="material-icons">delete</span> 删除</div>
                </div>
            </div>
        `;

        // 点击行 -> 播放 (非批量模式下)
        li.addEventListener('click', (e) => {
            // 如果点的是复选框或菜单，不管
            if(e.target.closest('.batch-checkbox') || e.target.closest('.song-actions')) return;

            if(isBatchMode) {
                // 批量模式：点击行等于勾选
                const cb = li.querySelector('.batch-checkbox');
                cb.checked = !cb.checked;
                handleSelect(index, cb.checked);
            } else {
                playSong(index);
            }
        });

        // 复选框事件
        const cb = li.querySelector('.batch-checkbox');
        cb.addEventListener('change', (e) => handleSelect(index, e.target.checked));

        // 更多菜单
        const moreBtn = li.querySelector('.more-btn');
        const menu = li.querySelector('.context-menu');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.context-menu').forEach(m => m.classList.remove('show'));
            menu.classList.add('show');
        });

        // 单个删除
        const delOne = li.querySelector('.delete-one');
        delOne.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteOne(index);
        });

        els.list.appendChild(li);
    });

    if(isBatchMode) document.body.classList.add('batch-mode');
    else document.body.classList.remove('batch-mode');
}

function playSong(idx) {
    if(idx < 0 || idx >= songs.length) return;
    currentIndex = idx;
    const s = songs[idx];
    audio.src = s.url;
    audio.play();
    isPlaying = true;
    updateUI(s);
    renderList();
}

function updateUI(s) {
    els.title.innerText = s.name;
    els.artist.innerText = s.artist;
    els.playBtn.innerHTML = '<span class="material-icons">pause</span>';
}

function togglePlay() {
    if(!audio.src && songs.length > 0) playSong(0);
    else if(audio.paused) {
        audio.play();
        isPlaying = true;
        els.playBtn.innerHTML = '<span class="material-icons">pause</span>';
    } else {
        audio.pause();
        isPlaying = false;
        els.playBtn.innerHTML = '<span class="material-icons">play_arrow</span>';
    }
}

function playPrev() {
    let i = currentIndex - 1;
    if(i < 0) i = songs.length - 1;
    playSong(i);
}
function playNext() {
    let i = currentIndex + 1;
    if(i >= songs.length) i = 0;
    playSong(i);
}

// --- 批量功能实现 ---

function toggleBatchMode() {
    isBatchMode = !isBatchMode;
    if(isBatchMode) {
        els.batchBar.classList.remove('hidden');
        els.batchToggle.innerText = '完成';
    } else {
        els.batchBar.classList.add('hidden');
        els.batchToggle.innerText = '批量';
        selectedSet.clear();
    }
    renderList();
    updateBatchCount();
}

function handleSelect(index, checked) {
    if(checked) selectedSet.add(index);
    else selectedSet.delete(index);
    updateBatchCount();
}

function updateBatchCount() {
    els.selCount.innerText = selectedSet.size;
}

function deleteOne(index) {
    if(confirm('确定删除这首歌吗？')) {
        songs.splice(index, 1);
        if(currentIndex === index) { audio.pause(); isPlaying=false; els.playBtn.innerHTML='<span class="material-icons">play_arrow</span>'; }
        if(currentIndex > index) currentIndex--;
        renderList();
    }
}

function batchDelete() {
    if(selectedSet.size === 0) return;
    if(confirm(`确定删除选中的 ${selectedSet.size} 首歌曲吗？`)) {
        const sorted = Array.from(selectedSet).sort((a,b)=>b-a);
        sorted.forEach(i => {
            songs.splice(i, 1);
            if(i === currentIndex) { audio.pause(); isPlaying=false; }
        });
        currentIndex = -1;
        toggleBatchMode();
    }
}

function batchExport() {
    if(selectedSet.size === 0) return;
    alert("正在批量导出，请留意浏览器下载提示...");
    selectedSet.forEach(i => {
        const s = songs[i];
        const a = document.createElement('a');
        a.href = s.url;
        a.download = `${s.name}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
    toggleBatchMode();
}

init();
