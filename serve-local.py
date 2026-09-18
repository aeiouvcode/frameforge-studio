from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class LocalOnlyHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

if __name__ == "__main__":
    url = "http://127.0.0.1:4173/"
    print(f"FrameForge local server: {url}")
    ThreadingHTTPServer(("127.0.0.1", 4173), LocalOnlyHandler).serve_forever()
