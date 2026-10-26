"""Synthesizes demo/voiceover.json into demo/out/vo/*.wav.

Default engine is Kokoro (https://github.com/thewh1teagle/kokoro-onnx), run with a Python that has
`kokoro-onnx` and `soundfile` installed:

    KOKORO_MODEL=/path/kokoro-v1.0.onnx KOKORO_VOICES=/path/voices-v1.0.bin python demo/voiceover.py

Optional: KOKORO_VOICE (default am_michael), KOKORO_SPEED (default 1.0).
Piper also works: TTS_ENGINE=piper PIPER=/path/to/piper PIPER_VOICE=/path/en_US-ryan-high.onnx.

Run after demo/record-demo.ts and before demo/assemble.py, which mixes the lines in at their cues.
"""
import json
import os
import subprocess
from pathlib import Path

VO = Path('demo/out/vo')
ENGINE = os.environ.get('TTS_ENGINE', 'kokoro')

VO.mkdir(parents=True, exist_ok=True)
script = json.loads(Path('demo/voiceover.json').read_text())

if ENGINE == 'kokoro':
    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(os.environ['KOKORO_MODEL'], os.environ['KOKORO_VOICES'])
    voice = os.environ.get('KOKORO_VOICE', 'am_michael')
    speed = float(os.environ.get('KOKORO_SPEED', '1.0'))

    def synth(text, out):
        samples, rate = kokoro.create(text, voice=voice, speed=speed, lang='en-us')
        sf.write(out, samples, rate)
else:
    def synth(text, out):
        subprocess.run(
            [os.environ.get('PIPER', 'piper'), '-m', os.environ['PIPER_VOICE'], '--length-scale', '1.05',
             '--sentence-silence', '0.25', '-f', str(out)],
            input=text, text=True, check=True, capture_output=True,
        )

for scene, lines in script.items():
    if scene.startswith('_'):
        continue
    for i, line in enumerate(lines):
        out = VO / f'{scene}-{i}.wav'
        synth(line.get('say', line['text']), out)
        print(out)
