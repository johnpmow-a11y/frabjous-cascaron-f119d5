const SOUND_TOUCH_MODULE = 'https://esm.sh/@soundtouchjs/audio-worklet@2.1.1?bundle';
const SOUND_TOUCH_PROCESSOR = 'https://cdn.jsdelivr.net/npm/@soundtouchjs/audio-worklet@2.1.1/.dist/soundtouch-processor.js';

const MODES = {
  natural: { pitch: 0, echo: 0, robot: 0 },
  female: { pitch: 4, echo: 0, robot: 0 },
  male: { pitch: -3, echo: 0, robot: 0 },
  echo: { pitch: 0, echo: 0.28, robot: 0 },
  robot: { pitch: -1, echo: 0, robot: 0.42 },
};

export async function createAamVoiceChanger({ room, LK, mode = 'natural' }) {
  if (!room || !LK) throw new Error('An active call is required for voice effects.');
  const publication = [...room.localParticipant.audioTrackPublications.values()]
    .find(item => item.source === LK.Track.Source.Microphone && item.track?.mediaStreamTrack);
  const originalTrack = publication?.track;
  if (!room.localParticipant.isMicrophoneEnabled) throw new Error('Turn on your microphone before applying a voice effect.');
  if (!originalTrack?.mediaStreamTrack) throw new Error('Your call microphone is not ready.');

  const context = new AudioContext();
  let source, shifter, destination, outputTrack, echoDelay, echoFeedback, echoWet, robotGain, robotOscillator, robotDepth;
  let stopped = false;
  let muted = false;
  let originalUnpublished = false;
  let outputPublished = false;

  try {
    await context.resume();
    const { SoundTouchNode } = await import(SOUND_TOUCH_MODULE);
    await SoundTouchNode.register(context, SOUND_TOUCH_PROCESSOR);

    source = context.createMediaStreamSource(new MediaStream([originalTrack.mediaStreamTrack]));
    shifter = new SoundTouchNode({ context });
    destination = context.createMediaStreamDestination();
    echoDelay = context.createDelay(0.65);
    echoFeedback = context.createGain();
    echoWet = context.createGain();
    robotGain = context.createGain();
    robotOscillator = context.createOscillator();
    robotDepth = context.createGain();

    echoDelay.delayTime.value = 0.22;
    echoFeedback.gain.value = 0.24;
    echoWet.gain.value = 0;
    robotGain.gain.value = 1;
    robotOscillator.type = 'sine';
    robotOscillator.frequency.value = 34;
    robotDepth.gain.value = 0;
    robotOscillator.connect(robotDepth);
    robotDepth.connect(robotGain.gain);
    robotOscillator.start();

    source.connect(shifter);
    shifter.connect(robotGain);
    robotGain.connect(destination);
    shifter.connect(echoDelay);
    echoDelay.connect(echoFeedback);
    echoFeedback.connect(echoDelay);
    echoDelay.connect(echoWet);
    echoWet.connect(destination);

    outputTrack = destination.stream.getAudioTracks()[0];
    if (!outputTrack) throw new Error('Could not create the processed microphone track.');

    await room.localParticipant.unpublishTrack(originalTrack, false);
    originalUnpublished = true;
    await room.localParticipant.publishTrack(outputTrack, {
      source: LK.Track.Source.Microphone,
      name: 'All Ads Manager voice effect',
    });
    outputPublished = true;

    const controller = {
      setMode(nextMode) {
        if (stopped) throw new Error('Voice effects have already stopped.');
        const config = MODES[nextMode] || MODES.natural;
        const now = context.currentTime;
        shifter.pitchSemitones.setTargetAtTime(config.pitch, now, 0.06);
        echoWet.gain.setTargetAtTime(config.echo, now, 0.06);
        robotDepth.gain.setTargetAtTime(config.robot, now, 0.06);
      },
      get isMuted() { return muted; },
      setMuted(nextMuted) {
        if (stopped) return;
        muted = !!nextMuted;
        outputTrack.enabled = !muted;
      },
      async stop({ restoreMic = true } = {}) {
        if (stopped) return;
        stopped = true;
        if (outputPublished) await room.localParticipant.unpublishTrack(outputTrack).catch(() => {});
        outputTrack?.stop();
        robotOscillator?.stop();
        source?.disconnect();
        shifter?.disconnect();
        echoDelay?.disconnect();
        echoFeedback?.disconnect();
        echoWet?.disconnect();
        robotGain?.disconnect();
        robotDepth?.disconnect();
        if (context.state !== 'closed') await context.close().catch(() => {});
        if (originalUnpublished && restoreMic && room.state !== 'disconnected' && originalTrack.mediaStreamTrack?.readyState !== 'ended') {
          originalTrack.mediaStreamTrack.enabled = !muted;
          await room.localParticipant.publishTrack(originalTrack, { source: LK.Track.Source.Microphone }).catch(async () => {
            await room.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
          });
          await room.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
        } else if (originalUnpublished && originalTrack.mediaStreamTrack?.readyState !== 'ended') {
          originalTrack.stop();
        }
        outputPublished = false;
        originalUnpublished = false;
      },
    };
    controller.setMode(mode);
    return controller;
  } catch (error) {
    if (outputPublished) await room.localParticipant.unpublishTrack(outputTrack).catch(() => {});
    outputTrack?.stop();
    robotOscillator?.stop();
    if (context.state !== 'closed') await context.close().catch(() => {});
    if (originalUnpublished && room.state !== 'disconnected' && originalTrack.mediaStreamTrack?.readyState !== 'ended') {
      originalTrack.mediaStreamTrack.enabled = !muted;
      await room.localParticipant.publishTrack(originalTrack, { source: LK.Track.Source.Microphone }).catch(async () => {
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
      });
    }
    throw error;
  }
}
