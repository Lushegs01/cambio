"""Cuts demo/out/scene-*.webm (see demo/record-demo.ts) into demo/cambio-demo.mp4 with crossfades."""
import json
import subprocess
from pathlib import Path

OUT = Path('demo/out')
FADE = 0.5
# Longest each scene may run, in seconds; anything after is navigation wait we don't need.
MAX_LEN = {'landing': 5.0}

scenes = json.loads((OUT / 'scenes.json').read_text())
inputs, filters, lengths = [], [], []
def duration(file):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
                         check=True, capture_output=True, text=True).stdout
    return float(out)


for i, s in enumerate(scenes):
    # Recording starts a little after the page is created, so shift the wall-clock marks onto the video.
    lag = max(0.0, s['end'] - duration(s['file']))
    s['start'] = max(0.0, s['start'] - lag)
    length = min(s['end'] - lag - s['start'] - 0.1, MAX_LEN.get(s['name'], 1e9))
    lengths.append(length)
    inputs += ['-i', s['file']]
    filters.append(
        f"[{i}:v]trim=start={s['start']:.3f}:duration={length:.3f},setpts=PTS-STARTPTS,"
        f"fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v{i}]"
    )

prev, offset = 'v0', 0.0
for i in range(1, len(scenes)):
    offset += lengths[i - 1] - FADE
    filters.append(f"[{prev}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[x{i}]")
    prev = f'x{i}'
total = sum(lengths) - FADE * (len(scenes) - 1)
filters.append(f"[{prev}]fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.8:.3f}:d=0.8[vout]")

cmd = [
    'ffmpeg', '-y', '-loglevel', 'error', *inputs,
    '-f', 'lavfi', '-t', f'{total:.3f}', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', ';'.join(filters),
    '-map', '[vout]', '-map', f'{len(scenes)}:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart', 'demo/cambio-demo.mp4',
]
subprocess.run(cmd, check=True)
print(f'wrote demo/cambio-demo.mp4 ({total:.1f}s)')
