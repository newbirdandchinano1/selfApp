import { Audio } from 'expo-av';

let dingSound: Audio.Sound | null = null;
let audioModeReady = false;

/** 打卡成功时播放短「叮」提示音（失败静默忽略） */
export async function playHabitCheckInDing(): Promise<void> {
  try {
    if (!audioModeReady) {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        playsThroughEarpieceAndroid: false,
        shouldDuckAndroid: true,
      });
      audioModeReady = true;
    }
    if (!dingSound) {
      const { sound } = await Audio.Sound.createAsync(require('../assets/sounds/ding.mp3'));
      dingSound = sound;
    }
    await dingSound.setPositionAsync(0);
    await dingSound.playAsync();
  } catch {
    /* 静音或资源失败时不打断打卡 */
  }
}
