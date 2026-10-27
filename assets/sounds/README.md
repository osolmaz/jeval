# Sounds

Eight short percussive clips that the viewer plays during a chess game, one for each event that its file name names.
They are cut from one recording in the public domain and are in the public domain themselves, so they need no
attribution. The table `SOUND_SET` in [`src/view/sounds.ts`](../../src/view/sounds.ts) maps each event to its file.

Each clip is a 48 kHz, 16-bit stereo WAV file, trimmed, with a 2 ms fade in and an 8 ms fade out, and peak-normalized
to -3 dBFS.

| Clip             | Event                  | Length | Spectral centroid | RMS      |
| ---------------- | ---------------------- | ------ | ----------------- | -------- |
| `game-start.wav` | game start             | 142 ms | 1031 Hz           | -19.2 dB |
| `move.wav`       | move                   | 97 ms  | 1048 Hz           | -26.0 dB |
| `castling.wav`   | castling               | 188 ms | 3373 Hz           | -28.7 dB |
| `capture.wav`    | capture                | 149 ms | 2944 Hz           | -26.8 dB |
| `check.wav`      | check                  | 128 ms | 4631 Hz           | -23.5 dB |
| `game-over.wav`  | game over              | 146 ms | 1010 Hz           | -19.8 dB |
| `stalemate.wav`  | game over by stalemate | 203 ms | 1038 Hz           | -21.3 dB |
| `checkmate.wav`  | game over by checkmate | 192 ms | 3262 Hz           | -20.2 dB |
