"""Cuts demo/out/scene-*.webm (see demo/record-demo.ts) into demo/cambio-demo.mp4 with crossfades.

If demo/out/vo/ holds the narration from demo/voiceover.py, each line is mixed in at its cue, and a
scene whose narration outlasts its footage is extended (more footage when there is some, else a held frame).
"""
import json
import subprocess
from pathlib import Path

OUT = Path('demo/out')
VO = OUT / 'vo'
FADE = 0.5
GAP = 0.25  # minimum silence between two narration lines
TAIL = 0.6  # silence after a scene's last line before the next scene
# Longest each scene may run, in seconds, unless its narration needs more; anything after is navigation wait.
MAX_LEN = {'landing': 5.0}


def duration(file):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(file)],
                         check=True, capture_output=True, text=True).stdout
    return float(out)


scenes = json.loads((OUT / 'scenes.json').read_text())
script = json.loads(Path('demo/voiceover.json').read_text()) if VO.exists() else {}

inputs, filters, lengths, lines = [], [], [], []
for i, s in enumerate(scenes):
    # Recording starts a little after the page is created, so shift the wall-clock marks onto the video.
    lag = max(0.0, s['end'] - duration(s['file']))
    start = max(0.0, s['start'] - lag)
    available = s['end'] - lag - start - 0.1
    length = min(available, MAX_LEN.get(s['name'], 1e9))

    # Place this scene's narration: at its caption cue or fixed offset, never overlapping the previous line.
    cursor, placed = 0.0, []
    for j, line in enumerate(script.get(s['name'], [])):
        wav = VO / f"{s['name']}-{j}.wav"
        at = s['cues'][line['cue']] if 'cue' in line else line['at']
        at = max(at, cursor)
        d = duration(wav)
        placed.append((wav, at))
        cursor = at + d + GAP
    needed = cursor - GAP + TAIL if placed else 0.0
    extend = max(0.0, needed - length)
    real = min(available, length + extend)  # use more real footage first
    hold = max(0.0, needed - real)
    length = real + hold
    lengths.append(length)
    lines.append(placed)

    inputs += ['-i', s['file']]
    filters.append(
        f"[{i}:v]trim=start={start:.3f}:duration={real:.3f},setpts=PTS-STARTPTS,"
        f"fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p"
        + (f",tpad=stop_mode=clone:stop_duration={hold:.3f}" if hold > 0 else '')
        + f"[v{i}]"
    )

prev, offset = 'v0', 0.0
for i in range(1, len(scenes)):
    offset += lengths[i - 1] - FADE
    filters.append(f"[{prev}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[x{i}]")
    prev = f'x{i}'
total = sum(lengths) - FADE * (len(scenes) - 1)
filters.append(f"[{prev}]fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.8:.3f}:d=0.8[vout]")

# Audio: a silent bed the length of the video, plus every narration line at its absolute time.
audio_inputs = ['-f', 'lavfi', '-t', f'{total:.3f}', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
bed = len(scenes)
mix = [f'[{bed}:a]']
n = bed + 1
scene_start = 0.0
for i, placed in enumerate(lines):
    for wav, at in placed:
        audio_inputs += ['-i', str(wav)]
        ms = int((scene_start + at) * 1000)
        filters.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{n}]")
        mix.append(f'[a{n}]')
        n += 1
    scene_start += lengths[i] - FADE
filters.append(
    f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,"
    "highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
)

cmd = [
    'ffmpeg', '-y', '-loglevel', 'error', *inputs, *audio_inputs,
    '-filter_complex', ';'.join(filters),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', f'{total:.3f}', '-movflags', '+faststart', 'demo/cambio-demo.mp4',
]
subprocess.run(cmd, check=True)
print(f'wrote demo/cambio-demo.mp4 ({total:.1f}s, {n - bed - 1} narration lines)')
