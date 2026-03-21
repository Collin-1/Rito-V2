/**
 * Rito TTS speaks a string using the Web Speech Synthesis API.
 * Prefers a local en-US voice if available.
 * @param {string} ritoText Text for Rito to speak.
 * @param {number} [ritoRate=1.0] Rito speech rate.
 * @param {number} [ritoPitch=1.0] Rito speech pitch.
 */
export function speak(ritoText, ritoRate = 1.0, ritoPitch = 1.0) {
  window.speechSynthesis.cancel();
  const ritoUtterance = new SpeechSynthesisUtterance(ritoText);
  ritoUtterance.rate = ritoRate;
  ritoUtterance.pitch = ritoPitch;
  ritoUtterance.volume = 1;
  const ritoVoices = window.speechSynthesis.getVoices();
  const ritoPreferredVoice = ritoVoices.find(
    (ritoVoice) => ritoVoice.lang === "en-US" && ritoVoice.localService,
  );
  if (ritoPreferredVoice) {
    ritoUtterance.voice = ritoPreferredVoice;
  }
  window.speechSynthesis.speak(ritoUtterance);
}
