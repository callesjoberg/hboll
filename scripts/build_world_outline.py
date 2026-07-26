#!/usr/bin/env python3
"""Bygger data/world-outline.json — en förenklad världskarta (landmassor som
polylinjer, [[lat,lng],...] per delö/kontinent) att rita som bakgrund i
välkomstskärmens kartanimation (js/welcome.js).

Källa: world-atlas@2 (Natural Earth 110m, public domain), hämtad som
TopoJSON. Avkodas här till vanliga koordinatlistor en gång och sparas
statiskt — ingen TopoJSON-bibliotek behövs i webbläsaren, och världens
kustlinjer ändras inte, så filen behöver inte byggas om av CI:t.

Körs manuellt vid behov:
    python3 scripts/build_world_outline.py
"""
import json
import os
import urllib.request

SRC_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "world-outline.json")

# Öar/fragment mindre än detta (i kvadratgrader, ett grovt mått) plockas
# bort — de syns ändå inte på en liten, kraftigt inzoomad canvas och drar
# bara ner filstorleken i onödan.
MIN_BBOX_AREA = 0.15


def decode_arc(arc, scale, translate):
    x = y = 0
    kx, ky = scale
    tx, ty = translate
    pts = []
    for dx, dy in arc:
        x += dx
        y += dy
        pts.append((x * kx + tx, y * ky + ty))
    return pts


def ring_points(ring_arc_indices, arcs):
    pts = []
    for idx in ring_arc_indices:
        if idx >= 0:
            seg = arcs[idx]
        else:
            seg = list(reversed(arcs[~idx]))
        if pts and seg:
            seg = seg[1:]  # första punkten = förra ringens sista punkt
        pts.extend(seg)
    return pts


def bbox_area(pts):
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    return (max(lons) - min(lons)) * (max(lats) - min(lats))


def main():
    with urllib.request.urlopen(SRC_URL, timeout=20) as r:
        topo = json.loads(r.read())

    scale = topo["transform"]["scale"]
    translate = topo["transform"]["translate"]
    arcs = [decode_arc(a, scale, translate) for a in topo["arcs"]]

    land = topo["objects"]["land"]
    geoms = land["geometries"] if land["type"] == "GeometryCollection" else [land]

    rings = []
    for geom in geoms:
        if geom["type"] == "Polygon":
            polys = [geom["arcs"]]
        elif geom["type"] == "MultiPolygon":
            polys = geom["arcs"]
        else:
            continue
        for poly in polys:
            for ring in poly:
                pts = ring_points(ring, arcs)
                if len(pts) < 3:
                    continue
                if bbox_area(pts) < MIN_BBOX_AREA:
                    continue
                # [lat,lng] för att matcha data/landing-map.json, avrundat
                # till 2 decimaler (~1km) — gott nog för en dekorativ
                # bakgrundskarta, håller filstorleken nere.
                rings.append([[round(lat, 2), round(lng, 2)] for lng, lat in pts])

    out = {"rings": rings}
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"{len(rings)} landmassor, {size_kb:.1f} KB -> {OUT_PATH}")


if __name__ == "__main__":
    main()
