import * as THREE from 'three';
import { createCharacter } from '@wireface/sdk/create';
import { exportCharacter, loadCharacter } from '@wireface/sdk/three';
import { buildCharacter } from '@wireface/sdk/three/characters';

const $ = id => document.getElementById(id);
const canvas = $('avatarCanvas');
const status = $('avatarStatus');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#eaf0f8');
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
camera.position.set(0.15, 1.05, 3.5);
camera.lookAt(0, 0.82, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8290a8, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(-2.5, 4, 4);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb8d7ff, 1);
fillLight.position.set(3, 2, -2);
scene.add(fillLight);
const floor = new THREE.Mesh(new THREE.CircleGeometry(2.5, 48), new THREE.MeshStandardMaterial({ color: '#dce4ef', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.015;
floor.receiveShadow = true;
scene.add(floor);

let figure = null;
let currentLoadedCharacter = null;
let micStream = null;
let audioContext = null;
let stopLipSync = null;
let lastFrame = 0;
let elapsed = 0;
const DB_NAME = 'aam-wireface-avatar-lab';
const STORE = 'saved-avatars';

function setStatus(message, isError = false) {
  status.textContent = message;
  status.dataset.error = isError ? 'true' : 'false';
}
function resize() {
  const width = Math.max(280, canvas.clientWidth || 360);
  const height = Math.max(360, canvas.clientHeight || 480);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveAvatar(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function listAvatars() {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
async function refreshSaved() {
  const select = $('savedAvatars');
  const rows = await listAvatars();
  select.innerHTML = '<option value="">Saved avatars on this device</option>' + rows.map(row =>
    `<option value="${row.id}">${escapeHtml(row.name)} · ${row.bodyStyle === 'walter' ? 'Male figure' : 'Female figure'}</option>`
  ).join('');
}
async function makeFigure(bodyStyle = 'sarah', savedCharacter = null) {
  if (figure) {
    scene.remove(figure.root);
    figure.dispose();
    figure = null;
  }
  figure = buildCharacter(bodyStyle, { shadows: true });
  if (savedCharacter) {
    currentLoadedCharacter = savedCharacter;
    await figure.face.useCharacter(savedCharacter, { transition: 0 });
  } else currentLoadedCharacter = null;
  figure.gazeAt(camera);
  scene.add(figure.root);
  figure.root.position.set(0, 0, 0);
  setStatus('Avatar ready. Upload a clear, front-facing photograph to personalise its face.');
}
async function createFromPhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
  if (!figure) await makeFigure($('bodyStyle').value);
  setStatus('Creating your photo avatar on this device…');
  const character = await createCharacter(file, {
    kind: '3d',
    detector: 'local',
    mediapipe: {
      bundle: 'https://cdn.jsdelivr.net/gh/compsmart/wireface-sdk@8bb0b00649eb65013e7785859c4b9b59169e1178/assets/mediapipe/vision_bundle.mjs',
      wasm: 'https://cdn.jsdelivr.net/gh/compsmart/wireface-sdk@8bb0b00649eb65013e7785859c4b9b59169e1178/assets/mediapipe/wasm',
      model: 'https://cdn.jsdelivr.net/gh/compsmart/wireface-sdk@8bb0b00649eb65013e7785859c4b9b59169e1178/assets/mediapipe/face_landmarker.task',
    },
  });
  await figure.face.useCharacter(character, { transition: 0 });
  currentLoadedCharacter = character;
  const name = $('avatarName').value.trim() || file.name.replace(/\.[^.]+$/, '') || 'My avatar';
  const blob = await exportCharacter(character);
  await saveAvatar({ id: crypto.randomUUID(), name, bodyStyle: $('bodyStyle').value, character: blob, savedAt: Date.now() });
  await refreshSaved();
  setStatus(`${name} is ready. Your photo was processed locally; it was not uploaded by Wireface's local creation flow.`);
}
async function loadSavedAvatar(id) {
  if (!id) return;
  const row = (await listAvatars()).find(item => item.id === id);
  if (!row) return;
  $('bodyStyle').value = row.bodyStyle;
  await makeFigure(row.bodyStyle, await loadCharacter(row.character));
  $('avatarName').value = row.name;
  setStatus(`${row.name} loaded from this device.`);
}
async function stopMicrophone() {
  stopLipSync?.();
  stopLipSync = null;
  micStream?.getTracks().forEach(track => track.stop());
  micStream = null;
  if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  audioContext = null;
  $('micButton').textContent = 'Use microphone';
}
async function startMicrophone() {
  if (!figure?.face) throw new Error('Create or load an avatar first.');
  if (micStream) return stopMicrophone();
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  audioContext = new AudioContext();
  await audioContext.resume();
  stopLipSync = figure.face.listenTo(audioContext, micStream);
  $('micButton').textContent = 'Stop microphone';
  setStatus('Microphone active. Your voice drives mouth movement and the figure’s built-in speaking gestures.');
}

$('photoInput').addEventListener('change', async event => {
  try { await createFromPhoto(event.target.files?.[0]); }
  catch (error) { setStatus(error.message || 'Could not create the avatar.', true); }
  finally { event.target.value = ''; }
});
$('bodyStyle').addEventListener('change', async () => {
  try { await makeFigure($('bodyStyle').value); }
  catch (error) { setStatus(error.message || 'Could not change avatar body.', true); }
});
$('savedAvatars').addEventListener('change', async event => {
  try { await loadSavedAvatar(event.target.value); }
  catch (error) { setStatus(error.message || 'Could not load this avatar.', true); }
});
$('micButton').addEventListener('click', async () => {
  try { await startMicrophone(); }
  catch (error) { setStatus(error.message || 'Microphone access failed.', true); }
});
$('stopButton').addEventListener('click', () => stopMicrophone());
$('moodSelect').addEventListener('change', event => figure?.face?.express(event.target.value, 4));
$('saveDownload').addEventListener('click', async () => {
  if (!currentLoadedCharacter) return setStatus('Upload a photograph first.', true);
  const blob = await exportCharacter(currentLoadedCharacter);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${$('avatarName').value.trim() || 'aam-avatar'}.wireface.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

await makeFigure('sarah');
await refreshSaved();
resize();
renderer.setAnimationLoop(now => {
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
  lastFrame = now;
  elapsed += dt;
  figure?.update(dt, elapsed);
  renderer.render(scene, camera);
});
window.addEventListener('pagehide', () => {
  stopLipSync?.();
  micStream?.getTracks().forEach(track => track.stop());
  figure?.dispose();
  renderer.dispose();
});
