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
dragStartIndex: null, queueDragStartIndex: null
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
    const dur = formatTime(audio.duration);
    document.getElementById('total-duration').innerText = dur;
    document.getElementById('seek-bar').max = audio.duration;
    // Sync FS
    document.getElementById('total-duration-fs').innerText = dur;
    document.getElementById('seek-bar-fs').max = audio.duration;
});

});
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
let song = { id, file, title: file.name.replace(/\.[^/.]+$/, ""), artist: 'Unknown Artist', album: 'Unknown Album', duration: 0 };
if (window.jsmediatags) {
try { await new Promise(r => { window.jsmediatags.read(file, { onSuccess: t => {
if(t.tags.title) song.title = t.tags.title;
if(t.tags.artist) song.artist = t.tags.artist;
r();
}, onError: r }); }); } catch(e){}
}
state.allSongs.push(song);
MusicDB.addSong(song);
}
if (state.currentView === 'all-songs') renderSongList();
}
function playSongById(id) {
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
const timeStr = formatTime(cur);
document.getElementById('seek-bar').value = cur;
document.getElementById('current-time').innerText = timeStr;
document.getElementById('seek-bar-fs').value = cur;
document.getElementById('current-time-fs').innerText = timeStr;
}
function handleSeek(val) { audio.currentTime = val; }
function handleVolume(val) {
audio.volume = val;
document.getElementById('volume-bar').value = val;
document.getElementById('volume-bar-fs').value = val;
}
function toggleMute() {
const v = audio.volume > 0 ? 0 : 1;
handleVolume(v);
}
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
// Basic sort toggle for demonstration
if(!state.sortAsc) state.sortAsc = true; else state.sortAsc = !state.sortAsc;
state.allSongs.sort((a,b) => (a[key] > b[key] ? 1 : -1) * (state.sortAsc ? 1 : -1));
renderSongList();
}
function renderSongList() {
const list = getCurrentViewSongs();
const el = document.getElementById('song-list');
document.getElementById('song-count').innerText = list.length + ' songs';
el.innerHTML = '';
list.forEach((s, i) => {
const div = document.createElement('div');
div.className = 'song-item' + (state.allSongs[state.currentSongIndex]?.id === s.id ? ' active' : '');
// Updated HTML structure to match new CSS grid
div.innerHTML =  `<div class="col-index">${state.allSongs[state.currentSongIndex]?.id === s.id ? '<i class="fa-solid fa-play"></i>' : i+1}</div> <div class="col-title">${s.title}</div> <div class="col-artist">${s.artist}</div> <div class="col-album">${s.album}</div> <div class="col-time"></div> <div class="col-actions"> <button onclick="openAddToPlaylistModal('${s.id}')"><i class="fa-solid fa-plus"></i></button> <button onclick="removeSong('${s.id}')"><i class="fa-solid fa-trash"></i></button> </div>`;
div.ondblclick = () => playSongById(s.id);
    if(state.currentView!=='all-songs' && state.currentView!=='recent') {
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
document.querySelectorAll('.menu-item').forEach(e => e.classList.remove('active'));
// Select sidebar item
const menuItem = document.querySelector(`[data-view="${id}"]`);
if(menuItem) menuItem.classList.add('active');
// Update header title
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
function removeSong(id) { if(confirm("Delete song?")) { state.allSongs=state.allSongs.filter(x=>x.id!==id); MusicDB.deleteSong(id); renderSongList(); } }
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
div.innerHTML = `<div class="q-info-box"><div class="q-title">${s.title}</div><div class="q-artist" style="font-size:11px;color:#888;">${s.artist}</div></div><div class="queue-drag-handle"><i class="fa-solid fa-bars"></i></div>`;
div.onclick = e => { if(!e.target.closest('.queue-drag-handle')) { state.currentSongIndex=i; loadAndPlay(s); } };
el.appendChild(div);
});
}
// Modals
let songToAddId = null;
function openAddToPlaylistModal(id) {
if(!id) return;
songToAddId = id;
document.getElementById('modal-add-to-playlist').classList.remove('hidden');
const ul = document.getElementById('modal-playlist-list'); ul.innerHTML = '';
state.playlists.forEach(p => {
const li = document.createElement('li'); li.innerText = p.name;
li.onclick = () => { p.songIds.push(songToAddId); savePlaylists(); closeModal(); };
ul.appendChild(li);
});
}
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
