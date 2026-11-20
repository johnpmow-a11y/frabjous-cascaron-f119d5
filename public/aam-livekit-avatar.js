const WIREFACE_BASE = 'https://cdn.jsdelivr.net/gh/compsmart/wireface-sdk@8bb0b00649eb65013e7785859c4b9b59169e1178';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const VISION_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let avatarDependenciesPromise=null;
let visionTasksPromise=null;
function loadAvatarDependencies(){if(!avatarDependenciesPromise)avatarDependenciesPromise=Promise.all([import(THREE_URL),import(WIREFACE_BASE+'/dist/create.js'),import(WIREFACE_BASE+'/dist/three.js'),import(WIREFACE_BASE+'/dist/three-characters.js')]).catch(error=>{avatarDependenciesPromise=null;throw error;});return avatarDependenciesPromise;}
function loadVisionTasks(){if(!visionTasksPromise)visionTasksPromise=(async()=>{const module=await import(VISION_BASE+'/vision_bundle.mjs');const vision=await module.FilesetResolver.forVisionTasks(VISION_BASE+'/wasm');return {module,vision};})().catch(error=>{visionTasksPromise=null;throw error;});return visionTasksPromise;}
export async function preloadAamLiveKitAvatar({models=false}={}){await Promise.all([loadAvatarDependencies(),loadVisionTasks()]);if(models)await Promise.all([POSE_MODEL,HAND_MODEL,FACE_MODEL].map(url=>fetch(url,{mode:'cors',cache:'force-cache'}).catch(()=>null)));return true;}

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
    const material = palm.material || new THREE.MeshStandardMaterial({ color: 0xd8a98f, roughness: 0.82 });
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

function addLegRigs(THREE, figure) {
  const body = figure.body;
  const legs = body.children.filter(child => child.name === 'leg').sort((a, b) => a.position.x - b.position.x);
  const shoes = body.children.filter(child => child.name === 'shoe').sort((a, b) => a.position.x - b.position.x);
  return legs.map((leg, index) => {
    const shoe = shoes[index];
    const parameters = leg.geometry?.parameters || {};
    const radius = parameters.radius || 0.052;
    const totalLength = (parameters.length || 0.2) + radius * 2;
    const topY = leg.position.y + totalLength / 2;
    const footY = shoe?.position.y ?? 0.035;
    const legLength = Math.max(0.22, topY - footY);
    const upperLength = legLength * 0.52;
    const lowerLength = legLength - upperLength;
    const hip = new THREE.Group();
    hip.name = index === 0 ? 'aam-right-leg-hip' : 'aam-left-leg-hip';
    hip.position.set(leg.position.x, topY, leg.position.z);
    const upper = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, Math.max(0.01, upperLength - radius * 2), 4, 8),
      leg.material
    );
    upper.position.y = -upperLength / 2;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.name = 'aam-knee-joint';
    knee.position.y = -upperLength;
    hip.add(knee);
    const lowerRadius = radius * 0.94;
    const lower = new THREE.Mesh(
      new THREE.CapsuleGeometry(lowerRadius, Math.max(0.01, lowerLength - lowerRadius * 2), 4, 8),
      leg.material
    );
    lower.position.y = -lowerLength / 2;
    knee.add(lower);
    if (shoe) {
      body.remove(shoe);
      shoe.position.set(shoe.position.x - leg.position.x, shoe.position.y - (topY - upperLength), shoe.position.z - leg.position.z);
      knee.add(shoe);
    }
    body.remove(leg);
    leg.geometry?.dispose();
    body.add(hip);
    return { hip, knee };
  });
}

function kneeFlex(hip, knee, ankle) {
  if (!hip || !knee || !ankle) return 0;
  const a = [hip.x - knee.x, hip.y - knee.y];
  const b = [ankle.x - knee.x, ankle.y - knee.y];
  const dot = a[0] * b[0] + a[1] * b[1];
  const angle = Math.acos(clamp(dot / ((Math.hypot(...a) || 1) * (Math.hypot(...b) || 1)), -1, 1));
  const cross = a[0] * b[1] - a[1] * b[0];
  return clamp((Math.PI - angle) * (Math.sign(cross) || 1), -1.65, 1.65);
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

function faceMoodFromBlendshapes(categories) {
  const values = Object.fromEntries((categories || []).map(item => [item.categoryName, item.score || 0]));
  const smile = Math.max(values.mouthSmileLeft || 0, values.mouthSmileRight || 0);
  const frown = Math.max(values.mouthFrownLeft || 0, values.mouthFrownRight || 0);
  const browUp = values.browInnerUp || 0;
  const browDown = Math.max(values.browDownLeft || 0, values.browDownRight || 0);
  const eyesWide = Math.max(values.eyeWideLeft || 0, values.eyeWideRight || 0);
  if (smile > 0.48) return { mood: 'happy', intensity: clamp(smile, 0.25, 0.9) };
  if (eyesWide > 0.48 && browUp > 0.22) return { mood: 'surprised', intensity: clamp(eyesWide, 0.3, 0.85) };
  if (frown > 0.38 && browUp > 0.18) return { mood: 'sad', intensity: clamp(frown, 0.25, 0.8) };
  if (browDown > 0.48) return { mood: 'frustrated', intensity: clamp(browDown, 0.25, 0.8) };
  return { mood: 'neutral', intensity: 0.25 };
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
  const earCenterX=points[7]&&points[8]?(points[7].x+points[8].x)/2:shoulderX,earCenterY=points[7]&&points[8]?(points[7].y+points[8].y)/2:shoulderY,nose=points[0]||{x:earCenterX,y:earCenterY};
   const headYaw=clamp((nose.x-earCenterX)*3.6,-0.48,0.48),headPitch=clamp((nose.y-earCenterY-0.1)*2.2,-0.34,0.34),neckYaw=clamp((shoulderX-earCenterX)*1.5,-0.28,0.28),neckPitch=clamp((shoulderY-earCenterY+0.1)*0.8,-0.22,0.22);
   const legsVisible = [25, 26, 27, 28].every(visible);
  return {
    leftArm: armAngle(points[11], points[13]),
    rightArm: armAngle(points[12], points[14]),
    leftLeg: legsVisible ? armAngle(points[23], points[25]) : null,
    rightLeg: legsVisible ? armAngle(points[24], points[26]) : null,
    leftKnee: legsVisible ? kneeFlex(points[23], points[25], points[27]) : null,
    rightKnee: legsVisible ? kneeFlex(points[24], points[26], points[28]) : null,
    torsoZ: clamp((shoulderX - hipX) * 1.7, -0.35, 0.35),
    torsoX: clamp((shoulderY - hipY + 0.2) * 0.35, -0.18, 0.18),
    headZ: earTilt,
    rootX: clamp((hipX - 0.5) * 0.18, -0.08, 0.08),
  };
}

export async function createAamLiveKitAvatar({ room, LK, photoFile, savedCharacter = null, bodyStyle = 'sarah', mediaElement, trackBody = true }) {
  if (!room || !LK || (!photoFile && !savedCharacter)) throw new Error('A video call and a photograph or saved avatar are required.');
  if (photoFile && !photoFile.type?.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
  if (photoFile && photoFile.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
  if (!HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot publish an animated avatar video.');

  const [THREE, createModule, threeModule, characterModule] = await loadAvatarDependencies();
  const { createCharacter } = createModule;
  const { exportCharacter, loadCharacter } = threeModule;
  const { buildCharacter } = characterModule;
  if (!createCharacter || !buildCharacter || !exportCharacter) throw new Error('The avatar engine could not be loaded.');

  const mobileDevice = /iPhone|iPad|Android/i.test(navigator.userAgent || '');
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 640;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobileDevice, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileDevice ? 1 : 1.5));
  renderer.setSize(480, 640, false);
  renderer.shadowMap.enabled = !mobileDevice;

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

  const wasCameraEnabled = !!room.localParticipant.isCameraEnabled;
  let figure, currentPhotoCharacter, cameraLocalTrack, cameraVideo, poseLandmarker, handLandmarker, faceLandmarker;
  let currentBodyStyle = bodyStyle === 'walter' ? 'walter' : 'sarah';
  let fingerRigs = [], legRigs = [], audioContext, stopLipSync, micStream, videoTrack, preview;
  let published = false, stopped = false, trackingAvailable = false, cameraUnpublished = false;
  let lastFrame = 0, elapsed = 0, lastDetection = 0, lastFaceDetection = 0, lastVideoTime = -1, lastFaceVideoTime = -1, latestHands = null, targetPose = null, currentFaceMood = 'neutral';

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
    if (currentFaceMood !== 'neutral') next.face.mood(currentFaceMood, 0.5);
    next.gazeAt(camera);
    fingerRigs = addFingerRigs(THREE, next);
    legRigs = addLegRigs(THREE, next);
    return next;
  };

  try {
    currentPhotoCharacter = savedCharacter ? await loadCharacter(savedCharacter) : await makePhotoCharacter(photoFile);
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
      if (cameraVideo.readyState < 2) await new Promise(resolve => { cameraVideo.addEventListener('loadeddata', resolve, { once: true }); setTimeout(resolve, 2500); });
      try {
        if (cameraVideo.readyState < 2) throw new Error('Camera video did not become ready for tracking.');
        const {module:visionModule,vision} = await loadVisionTasks();
        poseLandmarker = await makeLandmarker(visionModule.PoseLandmarker, vision, POSE_MODEL, { numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        try { handLandmarker = await makeLandmarker(visionModule.HandLandmarker, vision, HAND_MODEL, { numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }); } catch (_) { handLandmarker = null; }
        try { faceLandmarker = await makeLandmarker(visionModule.FaceLandmarker, vision, FACE_MODEL, { numFaces: 1, outputFaceBlendshapes: true }); } catch (_) { faceLandmarker = null; }
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
      if (trackingAvailable && cameraVideo?.readyState >= 2 && now - lastDetection > (mobileDevice ? 150 : 100) && cameraVideo.currentTime !== lastVideoTime) {
        lastDetection = now;
        lastVideoTime = cameraVideo.currentTime;
        try {
          const poseResult = poseLandmarker.detectForVideo(cameraVideo, now);
          targetPose = poseTargets(poseResult.landmarks?.[0] || null);
          if (handLandmarker) latestHands = handLandmarker.detectForVideo(cameraVideo, now);
        } catch (_) {}
        if (faceLandmarker && cameraVideo?.readyState >= 2 && now - lastFaceDetection > (mobileDevice ? 300 : 220) && cameraVideo.currentTime !== lastFaceVideoTime) {
          lastFaceDetection = now;
          lastFaceVideoTime = cameraVideo.currentTime;
          try {
            const faceResult = faceLandmarker.detectForVideo(cameraVideo, now);
            const nextMood = faceMoodFromBlendshapes(faceResult.faceBlendshapes?.[0]?.categories);
            if (nextMood.mood !== currentFaceMood) {
              currentFaceMood = nextMood.mood;
              figure?.face?.mood(currentFaceMood, nextMood.intensity);
            }
          } catch (_) {}
        }
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
        if (figure.head) { figure.head.rotation.z = smooth(figure.head.rotation.z, targetPose.headZ, 0.22); figure.head.rotation.x = smooth(figure.head.rotation.x, targetPose.headX, 0.18); figure.head.rotation.y = smooth(figure.head.rotation.y, targetPose.headY, 0.18); }
        const neckRig=figure.neck||figure.body?.getObjectByName?.('neck')||figure.root?.getObjectByName?.('neck');
        if(neckRig){neckRig.rotation.x=smooth(neckRig.rotation.x,targetPose.neckX,0.16);neckRig.rotation.y=smooth(neckRig.rotation.y,targetPose.neckY,0.16);}
        if (targetPose.leftLeg && legRigs[1]) {
          legRigs[1].hip.rotation.z = smooth(legRigs[1].hip.rotation.z, targetPose.leftLeg.z);
          legRigs[1].hip.rotation.x = smooth(legRigs[1].hip.rotation.x, targetPose.leftLeg.x);
          legRigs[1].knee.rotation.z = smooth(legRigs[1].knee.rotation.z, targetPose.leftKnee);
        }
        if (targetPose.rightLeg && legRigs[0]) {
          legRigs[0].hip.rotation.z = smooth(legRigs[0].hip.rotation.z, targetPose.rightLeg.z);
          legRigs[0].hip.rotation.x = smooth(legRigs[0].hip.rotation.x, targetPose.rightLeg.x);
          legRigs[0].knee.rotation.z = smooth(legRigs[0].knee.rotation.z, targetPose.rightKnee);
        }
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
    faceLandmarker?.close?.();
    if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.remove(); }
    figure?.dispose();
    renderer.dispose();
    throw error;
  }

  return {
    get bodyTrackingEnabled() { return trackingAvailable; },
    get handTrackingEnabled() { return !!handLandmarker; },
    get faceTrackingEnabled() { return !!faceLandmarker; },
    async setPhoto(file) {
      if (stopped) throw new Error('This avatar has already been closed.');
      if (!file?.type?.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP photograph.');
      if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photograph smaller than 12 MB.');
      const next = await makePhotoCharacter(file);
      await figure.face.useCharacter(next, { transition: 0 });
      currentPhotoCharacter = next;
    },
    async setSavedCharacter(data) {
      if (stopped) throw new Error('This avatar has already been closed.');
      if (!data) throw new Error('The saved avatar is not available on this device.');
      const next = await loadCharacter(data);
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
      if (cameraLocalTrack) { await room.localParticipant.unpublishTrack(cameraLocalTrack, !trackingAvailable); cameraUnpublished = true; }
      else if (wasCameraEnabled) await room.localParticipant.setCameraEnabled(false);
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
        if (!cameraLocalTrack && wasCameraEnabled && room.state !== 'disconnected') await room.localParticipant.setCameraEnabled(true).catch(() => {});
        if (cameraLocalTrack && cameraUnpublished && room.state !== 'disconnected') {
          if (cameraLocalTrack.mediaStreamTrack?.readyState !== 'ended') {
            await room.localParticipant.publishTrack(cameraLocalTrack, { source: LK.Track.Source.Camera }).then(() => { cameraUnpublished = false; }).catch(async () => { await room.localParticipant.setCameraEnabled(true).catch(() => {}); cameraUnpublished = false; });
          } else { await room.localParticipant.setCameraEnabled(true).catch(() => {}); cameraUnpublished = false; }
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
      await faceLandmarker?.close?.();
      if (cameraVideo) { cameraVideo.pause(); cameraVideo.srcObject = null; cameraVideo.remove(); }
      figure?.dispose();
      renderer.dispose();
      if (cameraLocalTrack && cameraUnpublished) {
        if (restoreCamera && room.state !== 'disconnected') {
          if (cameraLocalTrack.mediaStreamTrack?.readyState !== 'ended') {
            await room.localParticipant.publishTrack(cameraLocalTrack, { source: LK.Track.Source.Camera }).catch(async () => { await room.localParticipant.setCameraEnabled(true).catch(() => {}); });
          } else await room.localParticipant.setCameraEnabled(true).catch(() => {});
        } else if (cameraLocalTrack.mediaStreamTrack?.readyState !== 'ended') cameraLocalTrack.stop();
      } else if (!cameraLocalTrack && wasCameraEnabled && restoreCamera && room.state !== 'disconnected') await room.localParticipant.setCameraEnabled(true).catch(() => {});
      published = false;
    },
    async exportFace() { return exportCharacter(currentPhotoCharacter); },
  };
}
