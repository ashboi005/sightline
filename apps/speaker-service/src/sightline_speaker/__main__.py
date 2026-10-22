"""Explicit loopback service startup; no implicit model download."""

import argparse
from pathlib import Path

import uvicorn

from .api import create_app
from .settings import Settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=7799)
    parser.add_argument("--origin", default="http://localhost:3001")
    parser.add_argument("--data-dir", type=Path, default=Path("data/sessions"))
    parser.add_argument("--assets", type=Path, default=Path("data/assets"))
    parser.add_argument("--device", choices=["auto", "cpu", "mps"], default="auto")
    parser.add_argument("--engine", choices=["rtfs", "av-mossformer2"], default="rtfs")
    parser.add_argument("--noise", choices=["auto", "rnnoise", "off"], default="auto")
    args = parser.parse_args()
    settings = Settings(
        port=args.port,
        origin=args.origin,
        data_dir=args.data_dir,
        asset_dir=args.assets,
        device=args.device,
        engine=args.engine,
        noise=args.noise,
    )
    uvicorn.run(
        create_app(settings),
        host="127.0.0.1",
        port=settings.port,
        limit_concurrency=16,
        ws_max_size=512 * 1024,
    )


if __name__ == "__main__":
    main()
