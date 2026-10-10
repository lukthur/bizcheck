"""Serveur local pour tester le site (lancé par lancer_site.bat) : http://localhost:8000

Comme « python -m http.server 8000 --directory site », mais demande au navigateur de ne rien
garder en cache : après une modification du site, un simple rechargement montre la nouvelle version.
"""

import functools
import http.server
from pathlib import Path

PORT = 8000
DOSSIER_SITE = Path(__file__).parent / "site"


class SansCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


gestionnaire = functools.partial(SansCache, directory=DOSSIER_SITE)
http.server.ThreadingHTTPServer(("", PORT), gestionnaire).serve_forever()
