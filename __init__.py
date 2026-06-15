from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# Carpeta de extensiones web (browser de servidor — añadido en el fork de oveCom).
WEB_DIRECTORY = "./web"
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']

# ---- Browser de ficheros del SERVIDOR (fork oveCom) -------------------------
# Ruta de listado que usan los botones "📁 Browse…" de los nodos por ruta para
# navegar carpetas del servidor (incl. rutas absolutas como /mnt/s3files/<proyecto>)
# y elegir un fichero EXR/imagen o una carpeta. Solo lectura.
try:
    import os
    from server import PromptServer
    from aiohttp import web

    _IMG_EXTS = {".exr", ".png", ".jpg", ".jpeg", ".tif", ".tiff",
                 ".webp", ".bmp", ".hdr", ".dpx", ".tga"}

    @PromptServer.instance.routes.get("/hqis/browse")
    async def _hqis_browse(request):
        path = request.query.get("path") or "/"
        exts = request.query.get("exts")
        allow = ({"." + e.strip().lower().lstrip(".") for e in exts.split(",") if e.strip()}
                 if exts else _IMG_EXTS)
        try:
            path = os.path.abspath(path)
            entries = list(os.scandir(path))
        except Exception as e:
            return web.json_response({"error": str(e), "path": path,
                                      "parent": os.path.dirname(path), "dirs": [], "files": []})
        dirs, files = [], []
        for e in entries:
            try:
                if e.is_dir():
                    dirs.append(e.name)
                elif os.path.splitext(e.name)[1].lower() in allow:
                    files.append(e.name)
            except OSError:
                pass
        dirs.sort(); files.sort()
        return web.json_response({"path": path, "parent": os.path.dirname(path),
                                  "dirs": dirs, "files": files})
except Exception:  # sin PromptServer (carga fuera de ComfyUI) → no-op
    pass
