#!/usr/bin/env python3
"""
Simple development server for Courgette Codifier
Serves files locally to avoid CORS issues with web workers
"""

import http.server
import socketserver
import os
import sys

PORT = 8000

class CourgetteHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom handler with proper MIME types for our files"""
    
    def end_headers(self):
        # Add CORS headers for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def guess_type(self, path):
        """Ensure proper MIME types"""
        mimetype = super().guess_type(path)
        if path.endswith('.js'):
            return ('application/javascript', None)
        return mimetype

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), CourgetteHTTPRequestHandler) as httpd:
        print(f"🥒 Courgette Codifier Development Server")
        print(f"📍 Serving at http://localhost:{PORT}")
        print(f"📂 Directory: {os.getcwd()}")
        print(f"\n✨ Open http://localhost:{PORT}/index.html in any browser")
        print(f"Press Ctrl+C to stop the server\n")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Shutting down server...")
            sys.exit(0)

if __name__ == "__main__":
    main()

