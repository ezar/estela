/**
 * The camera feed. It is processed every frame and never drawn: the hand is
 * inferred from the hole it opens in the swarm, and nothing personal ever
 * reaches the screen or the recording.
 */

export interface CameraStream {
  video: HTMLVideoElement;
  stop: () => void;
}

export async function startCamera(): Promise<CameraStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not expose a camera.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  // Kept in the document because some browsers refuse to decode a detached
  // video, but sized to a single transparent pixel.
  video.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.append(video);

  await video.play();
  await new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });

  return {
    video,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      video.remove();
    },
  };
}
