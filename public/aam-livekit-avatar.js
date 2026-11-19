const WIREFACE_BASE = 'https://cdn.jsdelivr.net/gh/compsmart/wireface-sdk@8bb0b00649eb65013e7785859c4b9b59169e1178';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';

export async function createAamLiveKitAvatar({ room, LK, photoFile, bodyStyle = 'sarah', mediaElement }) {
  if (!room || !LK || !photoFile) throw new Error('A video call and a photograph are required.');
  if (!photoFile.type?.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
  if (photoFile.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
  if (!HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot publish an animated avatar video.');

  const [THREE, createModule, threeModule, characterModule] = await Promise.all([
    import(THREE_URL),
    import(`${WIREFACE_BASE}/dist/create.js`),
    import(`${WIREFACE_BASE}/dist/three.js`),
    import(`${WIREFACE_BASE}/dist/three-characters.js`),
  ]);
  const { createCharacter } = createModule;
  const { exportCharacter } = threeModule;
  const { buildCharacter } = characterModule;
  if (!createCharacter || !buildCharacter || !exportCharacter) throw new Error('The avatar engine could not be loaded.');

  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 640;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(480, 640, false);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eaf0f8');
  const camera = new THREE.PerspectiveCamera(32, 0.75, 0.1, 30);
  camera.position.set(0.12, 1.05, 3.5);
  camera.lookAt(0, 0.82, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8290a8, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2.5, 4, 4);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8d7ff, 1);
  fill.position.set(3, 2, -2);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.5, 48), new THREE.MeshStandardMaterial({ color: '#dce4ef', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  floor.receiveShadow = true;
  scene.add(floor);

  let figure;
  let audioContext;
  let stopLipSync;
  let micStream;
  let videoTrack;
  let preview;
  let published = false;
  let stopped = false;
  const wasCameraEnabled = !!room.localParticipant.isCameraEnabled;
  let lastFrame = 0;
  let elapsed = 0;
  let currentPhotoCharacter = null;
  let currentBodyStyle = bodyStyle === 'walter' ? 'walter' : 'sarah';
  const makePhotoCharacter = file => createCharacter(file, {
    kind: '3d',
    detector: 'local',
    mediapipe: {
      bundle: `${WIREFACE_BASE}/assets/mediapipe/vision_bundle.mjs`,
      wasm: `${WIREFACE_BASE}/assets/mediapipe/wasm`,
      model: `${WIREFACE_BASE}/assets/mediapipe/face_landmarker.task`,
    },
  });

  try {
    const photoCharacter = await makePhotoCharacter(photoFile);
    currentPhotoCharacter = photoCharacter;
    figure = buildCharacter(currentBodyStyle, { shadows: true });
    await figure.face.useCharacter(photoCharacter, { transition: 0 });
    figure.gazeAt(camera);
    scene.add(figure.root);

    const micPublication = [...room.localParticipant.audioTrackPublications.values()]
      .find(publication => publication.track?.mediaStreamTrack);
    if (!micPublication) throw new Error('Your call microphone is not ready. Turn on your microphone first.');
    micStream = new MediaStream([micPublication.track.mediaStreamTrack]);
    audioContext = new AudioContext();
    await audioContext.resume();
    stopLipSync = figure.face.listenTo(audioContext, micStream);

    const capture = canvas.captureStream(24);
    videoTrack = capture.getVideoTracks()[0];
    if (!videoTrack) throw new Error('The browser could not create the avatar video track.');

    renderer.setAnimationLoop(now => {
      if (stopped) return;
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      lastFrame = now;
      elapsed += dt;
      figure?.update(dt, elapsed);
      renderer.render(scene, camera);
    });
  } catch (error) {
    stopped = true;
    stopLipSync?.();
    micStream?.getTracks().forEach(track => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    figure?.dispose();
    renderer.dispose();
    throw error;
  }

  return {
    async setBodyStyle(style) {
      if (stopped) throw new Error('This avatar has already been closed.');
      const nextStyle = style === 'walter' ? 'walter' : 'sarah';
      if (nextStyle === currentBodyStyle) return;
      const nextFigure = buildCharacter(nextStyle, { shadows: true });
      await nextFigure.face.useCharacter(currentPhotoCharacter, { transition: 0 });
      nextFigure.gazeAt(camera);
      scene.remove(figure.root);
      figure.dispose();
      figure = nextFigure;
      currentBodyStyle = nextStyle;
      scene.add(figure.root);
    },
    async setPhoto(file) {
      if (stopped) throw new Error('This avatar has already been closed.');
      if (!file?.type?.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
      if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
      const next = await makePhotoCharacter(file);
      await figure.face.useCharacter(next, { transition: 0 });
      currentPhotoCharacter = next;
    },
    async publish() {
      if (stopped) throw new Error('This avatar preview has already been closed.');
      if (published) return;
      if (wasCameraEnabled) await room.localParticipant.setCameraEnabled(false);
      try {
        await room.localParticipant.publishTrack(videoTrack, {
          source: LK.Track.Source.Camera,
          name: 'All Ads Manager photo avatar',
        });
        published = true;
        if (mediaElement) {
          preview = document.createElement('video');
          preview.autoplay = true;
          preview.playsInline = true;
          preview.muted = true;
          preview.className = 'aam-social-local-preview';
          preview.dataset.local = 'true';
          preview.dataset.avatar = 'true';
          preview.srcObject = new MediaStream([videoTrack]);
          mediaElement.querySelectorAll('[data-local="true"]').forEach(node => node.remove());
          mediaElement.prepend(preview);
          await preview.play().catch(() => {});
        }
      } catch (error) {
        if (wasCameraEnabled) await room.localParticipant.setCameraEnabled(true).catch(() => {});
        throw error;
      }
    },
    async stop({ restoreCamera = true } = {}) {
      if (stopped) return;
      stopped = true;
      renderer.setAnimationLoop(null);
      stopLipSync?.();
      stopLipSync = null;
      if (published) await room.localParticipant.unpublishTrack(videoTrack).catch(() => {});
      videoTrack?.stop();
      preview?.remove();
      micStream?.getTracks().forEach(track => track.stop());
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      figure?.dispose();
      renderer.dispose();
      if (restoreCamera && wasCameraEnabled && room.state !== 'disconnected') {
        await room.localParticipant.setCameraEnabled(true).catch(() => {});
      }
      published = false;
    },
    async exportFace() {
      return exportCharacter(currentPhotoCharacter);
    },
  };
}
