import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let dingPlayer: AudioPlayer | null = null;
let audioModeReady = false;

/** 打卡成功时播放短「叮」提示音（失败静默忽略） */
export async function playHabitCheckInDing(): Promise<void> {
  try {
    if (!audioModeReady) {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
        interruptionMode: 'mixWithOthers',
      });
      audioModeReady = true;
    }
    if (!dingPlayer) {
      dingPlayer = createAudioPlayer(require('../assets/sounds/ding.wav'));
      dingPlayer.volume = 0.9;
    }
    await dingPlayer.seekTo(0);
    dingPlayer.play();
  } catch {
    /* 静音或资源失败时不打断打卡 */
  }
}
