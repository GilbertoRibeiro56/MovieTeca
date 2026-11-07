"""Gera a prévia offline a partir de Index.html (sem dependências externas)."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / 'Index.html').read_text(encoding='utf-8')
preview = source.replace(
    '<head>', '<head>\n  <script>window.MOVIETECA_PREVIEW = true;</script>', 1
).replace(
    'MovieTeca · Meu catálogo de filmes</title>',
    'MovieTeca · Prévia offline</title>', 1
)
(root / 'PREVIA_Offline.html').write_text(preview, encoding='utf-8')
print('Prévia offline regenerada.')
