# Sounds

Twelve short percussive clips that the viewer plays as the pieces move. They are cut from one recording in the public
domain and are in the public domain themselves, so they need no attribution.

Each clip is a 48 kHz, 16-bit stereo WAV file, trimmed, with a 2 ms fade in and an 8 ms fade out, and peak-normalized
to -3 dBFS. The numbers follow the order of the source recording and say nothing about what a clip means: the table
`SOUND_SET` in [`src/view/sounds.ts`](../../src/view/sounds.ts) alone decides which clip each event plays.

| Clip     | Length | Spectral centroid | RMS      | Character                      |
| -------- | ------ | ----------------- | -------- | ------------------------------ |
| `01.wav` | 142 ms | 1031 Hz           | -19.2 dB | low                            |
| `02.wav` | 97 ms  | 1048 Hz           | -26.0 dB | low, quieter                   |
| `03.wav` | 77 ms  | 1200 Hz           | -24.8 dB | low, short                     |
| `04.wav` | 188 ms | 3373 Hz           | -28.7 dB | mid                            |
| `05.wav` | 202 ms | 3841 Hz           | -29.1 dB | mid, longest                   |
| `06.wav` | 149 ms | 2944 Hz           | -26.8 dB | mid                            |
| `07.wav` | 138 ms | 2937 Hz           | -26.5 dB | mid                            |
| `08.wav` | 128 ms | 4631 Hz           | -23.5 dB | bright                         |
| `09.wav` | 128 ms | 4613 Hz           | -23.4 dB | bright, near duplicate of `08` |
| `10.wav` | 146 ms | 1010 Hz           | -19.8 dB | low                            |
| `11.wav` | 203 ms | 1038 Hz           | -21.3 dB | low, longest                   |
| `12.wav` | 192 ms | 3262 Hz           | -20.2 dB | mid, loud                      |
