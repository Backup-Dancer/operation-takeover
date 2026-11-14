# Prep-phase dispatcher voice

The line "Prep phase team, gather intel and takedown the enemy!" is
original to Operation: Takeover (Cameron). The spoken recording in
`assets/audio/dispatch-prep.ogg` was synthesized on the development
machine and then radio-filtered with ffmpeg. No third-party game audio
was used.

## Piper

- Binary: [Piper](https://github.com/rhasspy/piper) (2023.11.14-2)
- License: MIT
- See `credits/licenses/PIPER-MIT.txt`

## Voice model: en_US-ljspeech-medium

- Source: [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)
  (`en/en_US/ljspeech/medium`)
- Training data: [LJ Speech Dataset](https://keithito.com/LJ-Speech-Dataset/)
  (public domain; US English female, single speaker)
- The medium-quality Piper model was trained from scratch on that
  dataset (public-domain speech). We only ship the resulting short
  line, not the model weights.

Piper itself is MIT-licensed. The LJ Speech dataset is public domain.
