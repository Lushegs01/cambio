"""Synthesizes demo/voiceover.json into demo/out/vo/*.wav with Piper (https://github.com/rhasspy/piper).

    PIPER=/path/to/piper PIPER_VOICE=/path/to/en_US-ryan-high.onnx python3 demo/voiceover.py

Run after demo/record-demo.ts and before demo/assemble.py, which mixes the lines in at their cues.
"""
import json
import os
import subprocess
from pathlib import Path

VO = Path('demo/out/vo')
PIPER = os.environ.get('PIPER', 'piper')
VOICE = os.environ['PIPER_VOICE']
# Slightly slower than Piper's default reads as a calmer narrator.
LENGTH_SCALE = os.environ.get('PIPER_LENGTH_SCALE', '1.05')

VO.mkdir(parents=True, exist_ok=True)
script = json.loads(Path('demo/voiceover.json').read_text())
for scene, lines in script.items():
    if scene.startswith('_'):
        continue
    for i, line in enumerate(lines):
        out = VO / f'{scene}-{i}.wav'
        subprocess.run(
            [PIPER, '-m', VOICE, '--length-scale', LENGTH_SCALE, '--sentence-silence', '0.25', '-f', str(out)],
            input=line.get('say', line['text']), text=True, check=True, capture_output=True,
        )
        print(f'{out}')
