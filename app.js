/* app.js */
// ================= Data & DB =================
const dbName = "WebMusicPlayerDB";
const storeName = "songs";
let db;
const MusicDB = {
init: () => new Promise((resolve, reject) => {
const r = indexedDB.open(dbName, 1);
r.onupgradeneeded = e => {
db = e.target.result;
if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "id" });
};
r.onsuccess = e => { db = e.target.result; resolve(db); };
r.onerror = e => reject(e);
}),
addSong: song => new Promise((resolve, reject) => {
const tx = db.transaction([storeName], "readwrite");
tx.objectStore(storeName).add(song).onsuccess = () => resolve(song);
}),
getAllSongs: () => new Promise((resolve) => {
const tx = db.transaction([storeName], "readonly");
tx.objectStore(storeName).getAll().onsuccess = e => resolve(e.target.result);
}),
deleteSong: id => new Promise((resolve) => {
const tx = db.transaction([storeName], "readwrite");
tx.objectStore(storeName).delete(id).onsuccess = () => resolve();
}),
clearAll: () => {
const tx = db.transaction([storeName], "readwrite");
tx.objectStore(storeName).clear();
}
};
const state = {
allSongs: [], playlists: [{ id: 'fav', name: 'Favorites', songIds: [] }], history: [],
currentView: 'all-songs', currentPlaylist: [], currentSongIndex: -1,
isPlaying: false, mode: 'sequence', volume: 1,
dragStartIndex: null, queueDragStartIndex: null,
isSelectionMode: false, selectedSongs: new Set()
};
const audio = new Audio();
document.addEventListener('DOMContentLoaded', async () => {
await MusicDB.init();
const saved = await MusicDB.getAllSongs();
if (saved && saved.length) state.allSongs = saved;
loadPlaylists();
renderSidebar();
renderSongList();
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('ended', handleSongEnd);
audio.addEventListener('loadedmetadata', () => {
    const dur = audio.duration;
    const durStr = formatTime(dur);
    document.getElementById('total-duration-fs').innerText = durStr;
    document.getElementById('seek-bar-fs').max = dur;
    document.getElementById('seek-bar').max = dur;
});

// 初始化封面
resetCoverToLogo();
});

// ================= Helpers =================
function resetCoverToLogo() {
const logoUrl = 'logo.png';
const miniCover = document.getElementById('current-cover');
const fsCover = document.getElementById('fp-cover');
miniCover.style.backgroundImage = `url('${logoUrl}')`;
miniCover.innerHTML = ''; 
fsCover.style.backgroundImage = `url('${logoUrl}')`;
fsCover.innerHTML = '';
}

// ================= Full Screen Player Logic =================
function openFullScreen(e) {
if (e && (e.target.closest('button') || e.target.closest('input'))) return;
document.getElementById('full-player-modal').classList.remove('hidden');
}
function closeFullScreen() {
document.getElementById('full-player-modal').classList.add('hidden');
}

// ================= Playback Logic =================
async function handleFiles(files) {
if (!files.length) return;
for (let file of files) {
const id = 's_' + Date.now() + Math.random().toString(36).substr(2);
let song = { id, file, title: file.name.replace(/\.[^/.]+$/, ""), artist: 'Unknown Artist', album: 'Unknown Album', duration: 0, cover: null };
if (window.jsmediatags) {
try { await new Promise(r => { window.jsmediatags.read(file, { onSuccess: t => {
if(t.tags.title) song.title = t.tags.title;
if(t.tags.artist) song.artist = t.tags.artist;
if(t.tags.album) song.album = t.tags.album;
if(t.tags.picture) {
    const data = t.tags.picture.data;
    const format = t.tags.picture.format;
    let base64String = "";
    for (let i = 0; i < data.length; i++) { base64String += String.fromCharCode(data[i]); }
    song.cover = `data:${format};base64,${window.btoa(base64String)}`;
}
r();
}, onError: r }); }); } catch(e){}
}
state.allSongs.push(song);
MusicDB.addSong(song);
}
if (state.currentView === 'all-songs') renderSongList();
}
function playSongById(id) {
// 批量模式下不播放
if(state.isSelectionMode) return;
const s = state.allSongs.find(x => x.id === id);
if (!s) return;
state.currentPlaylist = getCurrentViewSongs();
state.currentSongIndex = state.currentPlaylist.findIndex(x => x.id === id);
loadAndPlay(s);
}
function loadAndPlay(song) {
if (!song.file) return alert("File missing");
if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
audio.src = URL.createObjectURL(song.file);
audio.play().then(() => { state.isPlaying = true; updatePlayBtns(); }).catch(() => { state.isPlaying = false; updatePlayBtns(); });
updatePlayerBar(song);
renderSongList(); 
if (!document.getElementById('full-queue-modal').classList.contains('hidden')) renderQueue();
}
function togglePlay() {
if (!audio.src) { if (state.allSongs.length) playSongById(state.allSongs[0].id); return; }
state.isPlaying ? audio.pause() : audio.play();
state.isPlaying = !state.isPlaying;
updatePlayBtns();
}
function updatePlayBtns() {
const icon = state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
document.getElementById('play-pause-btn').innerHTML = icon;
document.getElementById('play-btn-fs').innerHTML = icon;
}
function updatePlayerBar(song) {
document.getElementById('current-name').innerText = song.title;
document.getElementById('current-artist').innerText = song.artist;
document.getElementById('fp-title').innerText = song.title;
document.getElementById('fp-artist').innerText = song.artist;

const coverUrl = song.cover || 'logo.png';
const miniCover = document.getElementById('current-cover');
const fsCover = document.getElementById('fp-cover');
miniCover.style.backgroundImage = `url('${coverUrl}')`;
miniCover.innerHTML = '';
fsCover.style.backgroundImage = `url('${coverUrl}')`;
fsCover.innerHTML = '';
}
function playNext() {
if (!state.currentPlaylist.length) return;
let idx = state.mode === 'shuffle' ? Math.floor(Math.random()*state.currentPlaylist.length) : state.currentSongIndex + 1;
if (idx >= state.currentPlaylist.length) idx = 0;
state.currentSongIndex = idx;
loadAndPlay(state.currentPlaylist[idx]);
}
function playPrev() {
if (!state.currentPlaylist.length) return;
if (audio.currentTime > 3) { audio.currentTime = 0; return; }
let idx = state.currentSongIndex - 1;
if (idx < 0) idx = state.currentPlaylist.length - 1;
state.currentSongIndex = idx;
loadAndPlay(state.currentPlaylist[idx]);
}
function handleSongEnd() { state.mode === 'one' ? (audio.currentTime=0, audio.play()) : playNext(); }
function toggleMode() {
const m = ['sequence', 'shuffle', 'one'];
state.mode = m[(m.indexOf(state.mode)+1)%3];
const icon = state.mode === 'sequence' ? 'fa-repeat' : (state.mode === 'shuffle' ? 'fa-shuffle' : 'fa-1');
const html = `<i class="fa-solid ${icon}"></i>`;
const btnMini = document.getElementById('mode-btn');
const btnFs = document.getElementById('mode-btn-fs');
btnMini.innerHTML = html; btnFs.innerHTML = html;
if(state.mode !== 'sequence') { btnMini.classList.add('active'); btnFs.classList.add('active'); }
else { btnMini.classList.remove('active'); btnFs.classList.remove('active'); }
}
// ================= UI Updates =================
function updateProgress() {
const cur = audio.currentTime;
const dur = audio.duration;
const timeStr = formatTime(cur);

// Update Values
document.getElementById('seek-bar').value = cur;
document.getElementById('seek-bar-fs').value = cur;

// Ensure Max is Set (Fix for NaN/0 issue)
if(dur && !isNaN(dur) && document.getElementById('seek-bar').max != dur) {
    document.getElementById('seek-bar').max = dur;
    document.getElementById('seek-bar-fs').max = dur;
    document.getElementById('total-duration-fs').innerText = formatTime(dur);
}

document.getElementById('current-time-fs').innerText = timeStr;
}

function handleSeek(val) { audio.currentTime = val; }
function handleVolume(val) { audio.volume = val; document.getElementById('volume-bar').value = val; }
function toggleMute() { const v = audio.volume > 0 ? 0 : 1; handleVolume(v); }
function formatTime(s) {
if(isNaN(s)) return "0:00";
const m=Math.floor(s/60), sec=Math.floor(s%60);
return `${m}:${sec<10?'0':''}${sec}`;
}
// ================= Views & Lists =================
function getCurrentViewSongs() {
let list = state.currentView === 'all-songs' ? state.allSongs : (state.currentView === 'recent' ? state.history.map(id=>state.allSongs.find(x=>x.id===id)).filter(x=>x) : state.playlists.find(p=>p.id===state.currentView)?.songIds.map(id=>state.allSongs.find(x=>x.id===id)).filter(x=>x) || []);
const k = document.getElementById('search-input').value.toLowerCase();
return k ? list.filter(s=>s.title.toLowerCase().includes(k)||s.artist.toLowerCase().includes(k)) : list;
}
function handleSearch(val) { renderSongList(); }
function sortSongs(key) {
if(!state.sortAsc) state.sortAsc = true; else state.sortAsc = !state.sortAsc;
state.allSongs.sort((a,b) => (a[key] > b[key] ? 1 : -1) * (state.sortAsc ? 1 : -1));
renderSongList();
}
function renderSongList() {
const list = getCurrentViewSongs();
const el = document.getElementById('song-list');
document.getElementById('song-count').innerText = list.length + ' songs';
el.innerHTML = '';

const selectHeader = document.getElementById('header-col-select');
if(state.isSelectionMode) selectHeader.classList.remove('hidden-col');
else selectHeader.classList.add('hidden-col');

list.forEach((s, i) => {
const div = document.createElement('div');
div.className = 'song-item' + (state.allSongs[state.currentSongIndex]?.id === s.id ? ' active' : '');

const isSelected = state.selectedSongs.has(s.id);
const checkboxHtml = `<div class="col-select ${state.isSelectionMode?'':'hidden-col'}"><input type="checkbox" ${isSelected?'checked':''} onchange="toggleSelectSong('${s.id}')" onclick="event.stopPropagation()"></div>`;

div.innerHTML =  `${checkboxHtml} <div class="col-index">${state.allSongs[state.currentSongIndex]?.id === s.id ? '<i class="fa-solid fa-play"></i>' : i+1}</div> <div class="col-title">${s.title}</div> <div class="col-artist">${s.artist}</div> <div class="col-album">${s.album}</div> <div class="col-time"></div> <div class="col-actions"> <button onclick="openMoreOptionsModal('${s.id}')"><i class="fa-solid fa-ellipsis"></i></button> </div>`;
div.ondblclick = () => playSongById(s.id);

if(state.isSelectionMode) {
    div.onclick = () => toggleSelectSong(s.id);
    div.style.cursor = "default";
} else {
    div.ondblclick = () => playSongById(s.id);
}

    if(state.currentView!=='all-songs' && state.currentView!=='recent' && !state.isSelectionMode) {
        div.draggable = true;
        div.ondragstart = e => { state.dragStartIndex = i; e.target.classList.add('dragging'); };
        div.ondragover = e => e.preventDefault();
        div.ondragdrop = e => { e.preventDefault(); };
    }
    el.appendChild(div);
});
}
function switchView(id) {
state.currentView = id;
if(state.isSelectionMode) toggleSelectionMode();
document.querySelectorAll('.menu-item').forEach(e => e.classList.remove('active'));
const menuItem = document.querySelector(`[data-view="${id}"]`);
if(menuItem) menuItem.classList.add('active');
const titles = { 'all-songs': 'All Songs', 'recent': 'Recently Played' };
const plName = state.playlists.find(p => p.id === id)?.name;
document.getElementById('view-title').innerText = titles[id] || plName || 'Library';
renderSongList();
}
function createPlaylist() {
const n = prompt("Playlist Name");
if(n) { state.playlists.push({id:'pl_'+Date.now(), name:n, songIds:[]}); savePlaylists(); renderSidebar(); }
}
function renderSidebar() {
const ul = document.getElementById('playlist-container'); ul.innerHTML = '';
state.playlists.forEach(p => {
const li = document.createElement('li'); li.className = 'menu-item' + (state.currentView===p.id?' active':'');
li.innerHTML = `<i class="fa-solid fa-list-music"></i> ${p.name}`;
li.onclick = () => switchView(p.id);
ul.appendChild(li);
});
}
function savePlaylists() { localStorage.setItem('playlists', JSON.stringify(state.playlists)); }
function loadPlaylists() { const d = localStorage.getItem('playlists'); if(d) state.playlists = JSON.parse(d); }
function removeSong(id) { 
if(confirm("Delete song?")) { 
    if(state.allSongs[state.currentSongIndex]?.id === id) {
        audio.pause(); audio.src = ''; state.isPlaying = false; resetCoverToLogo(); updatePlayBtns();
    }
    state.allSongs=state.allSongs.filter(x=>x.id!==id); 
    MusicDB.deleteSong(id); 
    renderSongList(); 
} 
}

// ================= Selection Mode & Batch Actions =================
function toggleSelectionMode() {
state.isSelectionMode = !state.isSelectionMode;
state.selectedSongs.clear();
document.getElementById('btn-select-mode').innerText = state.isSelectionMode ? 'Cancel' : 'Select';
const bar = document.getElementById('batch-bar');
if(state.isSelectionMode) bar.classList.remove('hidden'); else bar.classList.add('hidden');
updateBatchUI();
renderSongList();
}

function toggleSelectSong(id) {
if(state.selectedSongs.has(id)) state.selectedSongs.delete(id);
else state.selectedSongs.add(id);
updateBatchUI();
renderSongList();
}

function selectAll() {
const list = getCurrentViewSongs();
const allSelected = list.every(s => state.selectedSongs.has(s.id));
if(allSelected) state.selectedSongs.clear();
else list.forEach(s => state.selectedSongs.add(s.id));
updateBatchUI();
renderSongList();
}

function updateBatchUI() {
document.getElementById('selected-count').innerText = `${state.selectedSongs.size} Selected`;
}

function batchDelete() {
if(!state.selectedSongs.size) return;
if(confirm(`Delete ${state.selectedSongs.size} songs?`)) {
    const ids = Array.from(state.selectedSongs);
    ids.forEach(id => {
        if(state.allSongs[state.currentSongIndex]?.id === id) {
            audio.pause(); audio.src = ''; state.isPlaying = false; resetCoverToLogo(); updatePlayBtns();
        }
        MusicDB.deleteSong(id);
    });
    state.allSongs = state.allSongs.filter(s => !state.selectedSongs.has(s.id));
    toggleSelectionMode(); 
}
}

async function batchExport() {
if(!state.selectedSongs.size) return;
alert("Exporting songs... (Check your downloads)");
const ids = Array.from(state.selectedSongs);
for(const id of ids) {
    const song = state.allSongs.find(s => s.id === id);
    if(song && song.file) {
        const url = URL.createObjectURL(song.file);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${song.title}.mp3`; 
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise(r => setTimeout(r, 500)); 
    }
}
toggleSelectionMode();
}

function batchAddToPlaylist() {
if(!state.selectedSongs.size) return;
document.getElementById('modal-add-to-playlist').classList.remove('hidden');
const ul = document.getElementById('modal-playlist-list'); ul.innerHTML = '';
state.playlists.forEach(p => {
    const li = document.createElement('li'); li.innerText = p.name;
    li.onclick = () => { 
        const ids = Array.from(state.selectedSongs);
        ids.forEach(id => {
             if(!p.songIds.includes(id)) p.songIds.push(id);
        });
        savePlaylists(); 
        closeModal(); 
        toggleSelectionMode();
    };
    ul.appendChild(li);
});
}

// ================= Queue =================
function toggleQueue() {
const el = document.getElementById('full-queue-modal');
el.classList.toggle('hidden');
if(!el.classList.contains('hidden')) renderQueue();
}
function renderQueue() {
const el = document.getElementById('queue-content-list'); el.innerHTML = '';
state.currentPlaylist.forEach((s, i) => {
const div = document.createElement('div');
div.className = 'queue-list-item' + (i===state.currentSongIndex?' active':'');
div.draggable = true;
div.ondragstart = e => { state.queueDragStartIndex = i; e.dataTransfer.effectAllowed = 'move'; };
div.ondragover = e => e.preventDefault();
div.ondrop = e => {
e.preventDefault();
const from = state.queueDragStartIndex;
if(from===null || from===i) return;
const item = state.currentPlaylist.splice(from, 1)[0];
state.currentPlaylist.splice(i, 0, item);
if(state.currentSongIndex === from) state.currentSongIndex = i;
renderQueue();
};
div.innerHTML = `<div class="q-info-box"><div class="q-title">${s.title}</div><div class="q-artist">${s.artist}</div></div><div class="queue-drag-handle"><i class="fa-solid fa-bars"></i></div>`;
div.onclick = e => { if(!e.target.closest('.queue-drag-handle')) { state.currentSongIndex=i; loadAndPlay(s); } };
el.appendChild(div);
});
}
// Modals
let songToAddId = null;
function openMoreOptionsModal(id) {
if(!id) return;
songToAddId = id;
document.getElementById('modal-more-options').classList.remove('hidden');
}

function openAddToPlaylistModalFromOptions() {
closeModal();
document.getElementById('modal-add-to-playlist').classList.remove('hidden');
const ul = document.getElementById('modal-playlist-list'); ul.innerHTML = '';
state.playlists.forEach(p => {
const li = document.createElement('li'); li.innerText = p.name;
li.onclick = () => { p.songIds.push(songToAddId); savePlaylists(); closeModal(); };
ul.appendChild(li);
});
}

function deleteCurrentSong() {
closeModal();
if(songToAddId) removeSong(songToAddId);
}

async function shareCurrentSong() {
closeModal();
const song = state.allSongs.find(s => s.id === songToAddId);
if (!song || !song.file) {
alert("Cannot share this song.");
return;
}
if (navigator.share) {
try {
 await navigator.share({
    title: song.title,
    text: `Check out this song: ${song.title} by ${song.artist}`,
    files: [new File([song.file], `${song.title}.mp3`, { type: song.file.type })]
 });
} catch (error) {
 console.error('Error sharing:', error);
 alert(`Sharing failed or not supported for files on this browser.`);
}
} else {
alert("Web Share API is not supported in this browser.");
}
}

function closeModal() {
document.querySelectorAll('.modal, .queue-modal').forEach(m => m.classList.add('hidden'));
}
