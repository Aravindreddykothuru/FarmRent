import os
import antigravity  # keep your easter egg if you want :)
from app import app

if __name__ == "__main__":
    from waitress import serve
    
    # Read the Flask port from env configuration, default to 5001 for FarmRent integration
    port = int(os.getenv('FLASK_PORT', 5001))
    
    print(f"Starting production WSGI server (waitress) on http://0.0.0.0:{port}...")
    serve(app, host="0.0.0.0", port=port)  # production-safe server
