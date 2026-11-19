const WIREFACE_BASE = 'https://cdn.jsdelivr.net/gh/compsmart/wireface-sdk@8bb0b00649eb65013e7785859c4b9b59169e1178';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const VISION_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (current, target, amount = 0.28) => current + (target - current) * amount;

async function makeLandmarker(Landmarker, vision, modelAssetPath, taskOptions = {}) {
  const create = delegate => Landmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', ...taskOptions,
  });
  try { return await create('GPU'); }
  catch (_) { return create('CPU'); }
}

function addFingerRigs(THREE, figure) {
  return (figure.arms || []).map(arm => {
    const palm = arm.getObjectByName('hand');
    if (!palm) return null;
    const material = new THREE.MeshStandardMaterial({ color: 0xd8a98f, roughness: 0.82 });
    const xOffsets = [-0.022, -0.011, 0, 0.011, 0.022];
    return xOffsets.map((x, index) => {
      const base = new THREE.Group();
      base.position.set(x, -0.028, 0.012);
      palm.add(base);
      const joints = [base];
      let parent = base;
      for (let segment = 0; segment < 3; segment++) {
        const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.0045, 0.012, 2, 5), material);
        mesh.position.y = -0.008;
        parent.add(mesh);
        const joint = new THREE.Group();
        joint.position.y = -0.016;
        parent.add(joint);
        joints.push(joint);
        parent = joint;
      }
      if (index === 0) base.rotation.z = -0.42;
      if (index === 4) base.rotation.z = 0.42;
      return { joints, index };
    });
  });
}

function fingerFlex(points, ids) {
  const a = points[ids[0]], b = points[ids[1]], c = points[ids[2]], d = points[ids[3]];
  if (!a || !b || !c || !d) return 0;
  const v1 = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const v2 = [d.x - c.x, d.y - c.y, (d.z || 0) - (c.z || 0)];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const n1 = Math.hypot(...v1) || 1;
  const n2 = Math.hypot(...v2) || 1;
  return clamp(Math.PI - Math.acos(clamp(dot / (n1 * n2), -1, 1)), 0, 1.55);
}

function applyHandResults(result, fingerRigs, figure) {
  const fingerIds = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  const used = new Set();
  (result?.landmarks || []).forEach((points, index) => {
    const handed = result.handednesses?.[index]?.[0]?.categoryName || result.handedness?.[index]?.[0]?.categoryName;
    const side = handed === 'Left' ? 1 : handed === 'Right' ? 0 : (points[0]?.x > 0.5 ? 1 : 0);
    const rigs = fingerRigs[side];
    if (!rigs) return;
    used.add(side);
    const palm = figure.arms?.[side]?.getObjectByName('hand');
    if (palm && points[0] && points[9]) {
      const wrist = points[0], middle = points[9];
      palm.rotation.z = clamp(Math.atan2(middle.x - wrist.x, wrist.y - middle.y), -0.8, 0.8);
    }
    fingerIds.forEach((ids, fingerIndex) => {
      const rig = rigs[fingerIndex];
      if (!rig) return;
      const flex = fingerFlex(points, ids);
      rig.joints[0].rotation.x = smooth(rig.joints[0].rotation.x, flex * 0.32, 0.35);
      rig.joints[1].rotation.x = smooth(rig.joints[1].rotation.x, flex * 0.48, 0.35);
      rig.joints[2].rotation.x = smooth(rig.joints[2].rotation.x, flex * 0.36, 0.35);
    });
  });
  fingerRigs.forEach((rigs, side) => {
    if (!rigs || used.has(side)) return;
    rigs.forEach(rig => rig.joints.forEach(joint => { joint.rotation.x = smooth(joint.rotation.x, 0, 0.12); }));
  });
}

function poseTargets(points) {
  if (!points || points.length < 29) return null;
  const visible = index => (points[index]?.visibility ?? 1) > 0.35;
  if (![11, 12, 13, 14, 15, 16, 23, 24].every(visible)) return null;
  const armAngle = (shoulder, elbow) => {
    const dx = elbow.x - shoulder.x, dy = elbow.y - shoulder.y;
    return { z: clamp(Math.atan2(dx, dy), -2.35, 2.35), x: clamp(((elbow.z || 0) - (shoulder.z || 0)) * 2.1, -0.7, 0.7) };
  };
  const shoulderX = (points[11].x + points[12].x) / 2;
  const shoulderY = (points[11].y + points[12].y) / 2;
  const hipX = (points[23].x + points[24].x) / 2;
  const hipY = (points[23].y + points[24].y) / 2;
  const earTilt = points[7] && points[8] ? clamp(Math.atan2(points[8].y - points[7].y, points[8].x - points[7].x), -0.45, 0.45) : 0;
  return {
    leftArm: armAngle(points[11], points[13]),
    rightArm: armAngle(points[12], points[14]),
    torsoZ: clamp((shoulderX - hipX) * 1.7, -0.35, 0.35),
    torsoX: clamp((shoulderY - hipY + 0.2) * 0.35, -0.18, 0.18),
    headZ: earTilt,
    rootX: clamp((hipX - 0.5) * 0.18, -0.08, 0.08),
  };
}

export async function createAamLiveKitAvatar({ room, LK, photoFile, bodyStyle = 'sarah', mediaElement, trackBody = true }) {
  if (!room || !LK || !photoFile) throw new Error('A video call and a photograph are required.');
  if (!photoFile.type?.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
  if (photoFile.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
  if (!HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot publish an animated avatar video.');

  const [THREE, createModule, threeModule, characterModule] = await Promise.all([
    import(THREE_URL),
    import(WIREFACE_BASE + '/dist/create.js'),
    import(WIREFACE_BASE + '/dist/three.js'),
    import(WIREFACE_BASE + '/dist/three-characters.js'),
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

  let figure, currentPhotoCharacter, cameraLocalTrack, cameraVideo, poseLandmarker, handLandmarker;
  let currentBodyStyle = bodyStyle === 'walter' ? 'walter' : 'sarah';
  let fingerRigs = [], audioContext, stopLipSync, micStream, videoTrack, preview;
  let published = false, stopped = false, trackingAvailable = false;
  let lastFrame = 0, elapsed = 0, lastDetection = 0, lastVideoTime = -1, latestHands = null, targetPose = null;

  const makePhotoCharacter = file => createCharacter(file, {
    kind: '3d', detector: 'local',
    mediapipe: {
      bundle: WIREFACE_BASE + '/assets/mediapipe/vision_bundle.mjs',
      wasm: WIREFACE_BASE + '/assets/mediapipe/wasm',
      model: WIREFACE_BASE + '/assets/mediapipe/face_landmarker.task',
    },
  });
  const buildFigure = async style => {
    const next = buildCharacter(style === 'walter' ? 'walter' : 'sarah', { shadows: true });
    await next.face.useCharacter(currentPhotoCharacter, { transition: 0 });
    next.gazeAt(camera);
    fingerRigs = addFingerRigs(THREE, next);
    return next;
  };

  try {
    currentPhotoCharacter = await makePhotoCharacter(photoFile);
    figure = await buildFigure(currentBodyStyle);
    scene.add(figure.root);

    const micPublication = [...room.localParticipant.audioTrackPublications.values()]
      .find(publication => publication.track?.mediaStreamTrack);
    if (!micPublication) throw new Error('Your call microphone is not ready. Turn on your microphone first.');
    // This wrapper references the existing LiveKit microphone. Never stop its underlying track here.
    micStream = new MediaStream([micPublication.track.mediaStreamTrack]);
    audioContext = new AudioContext();
    await audioContext.resume();
    stopLipSync = figure.face.listenTo(audioContext, micStream);

    const cameraPublication = [...room.localParticipant.videoTrackPublications.values()]
      .find(publication => publication.source === LK.Track.Source.Camera && publication.track?.mediaStreamTrack);
    cameraLocalTrack = cameraPublication?.track || null;
    if (cameraLocalTrack && trackBody) {
      cameraVideo = document.createElement('video');
      cameraVideo.muted = true;
      cameraVideo.autoplay = true;
      cameraVideo.playsInline = true;
      cameraVideo.style.display = 'none';
      cameraVideo.srcObject = new MediaStream([cameraLocalTrack.mediaStreamTrack]);
      document.body.appendChild(cameraVideo);
      await cameraVideo.play().catch(() => {});
      try {
        const visionModule = await import(VISION_BASE + '/vision_bundle.mjs');
        const vision = await visionModule.FilesetResolver.forVisionTasks(VISION_BASE + '/wasm');
        poseLandmarker = await makeLandmarker(visionModule.PoseLandmarker, vision, POSE_MODEL, { numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        try { handLandmarker = await makeLandmarker(visionModule.HandLandmarker, vision, HAND_MODEL, { numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }); } catch (_) { handLandmarker = null; }
        trackingAvailable = !!poseLandmarker;
      } catch (_) {
        trackingAvailable = false;
      }
    }

    const capture = canvas.captureStream(24);
    videoTrack = capture.getVideoTracks()[0];
    if (!videoTrack) throw new Error('The browser could not create the avatar video track.');

    renderer.setAnimationLoop(now => {
      if (stopped) return;
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      lastFrame = now;
      elapsed += dt;
      if (trackingAvailable && cameraVideo?.readyState >= 2 && now - lastDetection > 100 && cameraVideo.currentTime !== lastVideoTime) {
        lastDetection = now;
        lastVideoTime = cameraVideo.currentTime;
        try {
          const poseResult = poseLandmarker.detectForVideo(cameraVideo, now);
          targetPose = poseTargets(poseResult.landmarks?.[0] || null);
          if (handLandmarker) latestHands = handLandmarker.detectForVideo(cameraVideo, now);
        } catch (_) {}
      }
      figure?.update(dt, elapsed);
      if (targetPose && figure) {
        const left = figure.arms?.[1], right = figure.arms?.[0];
        if (left) {
          left.rotation.z = smooth(left.rotation.z, targetPose.leftArm.z);
          left.rotation.x = smooth(left.rotation.x, targetPose.leftArm.x);
        }
        if (right) {
          right.rotation.z = smooth(right.rotation.z, targetPose.rightArm.z);
          right.rotation.x = smooth(right.rotation.x, targetPose.rightArm.x);
        }
        if (figure.body) {
          figure.body.rotation.z = smooth(figure.body.rotation.z, targetPose.torsoZ, 0.18);
          figure.body.rotation.x = smooth(figure.body.rotation.x, targetPose.torsoX, 0.18);
        }
        if (figure.head) figure.head.rotation.z = smooth(figure.head.rotation.z, targetPose.headZ, 0.22);
        figure.root.position.x = smooth(figure.root.position.x, targetPose.rootX, 0.15);
      }
      if (latestHands && fingerRigs.length) applyHandResults(latestHands, fingerRigs, figure);
      renderer.render(scene, camera);
    });
  } catch (error) {
    stopped = true;
    stopLipSync?.();
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    poseLandmarker?.close?.();
    handLandmarker?.close?.();
    if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.remove(); }
    figure?.dispose();
    renderer.dispose();
    throw error;
  }

  return {
    get bodyTrackingEnabled() { return trackingAvailable; },
    async setPhoto(file) {
      if (stopped) throw new Error('This avatar has already been closed.');
      if (!file?.type?.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
      if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
      const next = await makePhotoCharacter(file);
      await figure.face.useCharacter(next, { transition: 0 });
      currentPhotoCharacter = next;
    },
    async setBodyStyle(style) {
      if (stopped) throw new Error('This avatar has already been closed.');
      const nextStyle = style === 'walter' ? 'walter' : 'sarah';
      if (nextStyle === currentBodyStyle) return;
      const nextFigure = await buildFigure(nextStyle);
      scene.remove(figure.root);
      figure.dispose();
      figure = nextFigure;
      currentBodyStyle = nextStyle;
      scene.add(figure.root);
    },
    async publish() {
      if (stopped) throw new Error('This avatar preview has already been closed.');
      if (published) return;
      if (cameraLocalTrack) await room.localParticipant.unpublishTrack(cameraLocalTrack, false);
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
        if (cameraLocalTrack && room.state !== 'disconnected') {
          await room.localParticipant.publishTrack(cameraLocalTrack, { source: LK.Track.Source.Camera }).catch(() => {});
        }
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
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      await poseLandmarker?.close?.();
      await handLandmarker?.close?.();
      if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.remove(); }
      figure?.dispose();
      renderer.dispose();
      if (cameraLocalTrack) {
        if (restoreCamera && room.state !== 'disconnected' && cameraLocalTrack.mediaStreamTrack?.readyState !== 'ended') {
          await room.localParticipant.publishTrack(cameraLocalTrack, { source: LK.Track.Source.Camera }).catch(async () => {
            await room.localParticipant.setCameraEnabled(true).catch(() => {});
          });
        } else if (cameraLocalTrack.mediaStreamTrack?.readyState !== 'ended') {
          cameraLocalTrack.stop();
        }
      } else if (restoreCamera && room.state !== 'disconnected') {
        await room.localParticipant.setCameraEnabled(true).catch(() => {});
      }
      published = false;
    },
    async exportFace() { return exportCharacter(currentPhotoCharacter); },
  };
}
