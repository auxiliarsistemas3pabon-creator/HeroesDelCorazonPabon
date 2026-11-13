"""Prueba de latencia y carga contra el backend local (Docker). Solo usa la libreria estandar.

Uso: python latency_test.py <base_url> <usuario> <clave> <salida.json>
"""
import http.cookiejar
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request

BASE, USER, PASSWORD, OUT = sys.argv[1:5]


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(op, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    start = time.perf_counter()
    try:
        with op.open(req, timeout=30) as resp:
            resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        exc.read()
        status = exc.code
    return (time.perf_counter() - start) * 1000, status


def pct(values, p):
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(len(ordered) * p))], 1)


def summarize(samples):
    times = [t for t, _ in samples]
    statuses = {}
    for _, s in samples:
        statuses[s] = statuses.get(s, 0) + 1
    return {
        "n": len(times), "min_ms": round(min(times), 1), "avg_ms": round(statistics.mean(times), 1),
        "p50_ms": pct(times, 0.50), "p95_ms": pct(times, 0.95), "p99_ms": pct(times, 0.99),
        "max_ms": round(max(times), 1), "status": statuses,
    }


results = {"base_url": BASE, "sequential": {}, "load": {}}
op = opener()
call(op, "GET", "/api/v1/auth/csrf/")  # calentamiento

login_samples = []
for _ in range(15):
    login_samples.append(call(opener(), "POST", "/api/v1/auth/login/", {"username": USER, "password": PASSWORD}))
results["sequential"]["POST /auth/login/ (correcto)"] = summarize(login_samples)

bad = [call(opener(), "POST", "/api/v1/auth/login/", {"username": "no.existe.qa", "password": "x"}) for _ in range(15)]
results["sequential"]["POST /auth/login/ (usuario inexistente)"] = summarize(bad)

attack = [call(opener(), "POST", "/api/v1/auth/login/", {"username": "' OR '1'='1' --", "password": "x"}) for _ in range(15)]
results["sequential"]["POST /auth/login/ (SQLi bloqueado)"] = summarize(attack)

call(op, "POST", "/api/v1/auth/login/", {"username": USER, "password": PASSWORD})
for path in ["/api/v1/auth/me/", "/api/v1/auth/csrf/", "/api/v1/users/areas/", "/api/v1/users/collaborators/",
             "/api/v1/users/staff-candidates/", "/api/v1/users/evaluators/", "/api/v1/questions/evaluations/"]:
    results["sequential"]["GET " + path] = summarize([call(op, "GET", path) for _ in range(30)])


def load(path, workers, per_worker):
    samples, lock = [], threading.Lock()
    session_ops = []
    for _ in range(workers):
        o = opener()
        call(o, "POST", "/api/v1/auth/login/", {"username": USER, "password": PASSWORD})
        session_ops.append(o)

    def run(o):
        for _ in range(per_worker):
            r = call(o, "GET", path)
            with lock:
                samples.append(r)

    threads = [threading.Thread(target=run, args=(o,)) for o in session_ops]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.perf_counter() - start
    summary = summarize(samples)
    summary.update({"workers": workers, "elapsed_s": round(elapsed, 2), "throughput_rps": round(len(samples) / elapsed, 1)})
    return summary


results["load"]["GET /auth/me/ x5 sesiones concurrentes"] = load("/api/v1/auth/me/", 5, 60)
results["load"]["GET /users/collaborators/ x5 sesiones concurrentes"] = load("/api/v1/users/collaborators/", 5, 60)

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(results, fh, indent=2, ensure_ascii=False)
print("ok")
