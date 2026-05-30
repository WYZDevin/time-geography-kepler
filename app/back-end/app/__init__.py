import logging

from flask import Flask
from flask_cors import CORS


def create_app() -> Flask:
    logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s: %(message)s")

    app = Flask(__name__)
    CORS(app)

    from .routes import api

    app.register_blueprint(api)

    return app
