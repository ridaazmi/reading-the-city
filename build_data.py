"""Export the GeoAI Morpho-Risque prototype outputs into a static web app.

Reads pre-computed notebook runs (outputs/<scene>/agent/*.gpkg, chips/, rue/, jsonl, html) and writes, under
site/data/<run>/, a small JS data file plus resized images. No GPU, no model, no token is needed at run time.

Usage:
    python build_data.py --src D:/SAM3hybrid/outputs [--with-photos]

--with-photos copies the Mapillary street photos (CC BY-SA 4.0, attribution required). Without it, the app only
links to each photo on mapillary.com.
"""
import argparse
import base64
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from PIL import Image
from scipy.stats import spearmanr

HERE = Path(__file__).resolve().parent
SITE = HERE / "site"

# Runs shown in the app, flagship first. `rue` = street-view stage was run.
RUNS = [
    {"id": "immo_congo", "scene": "v4rue_b22", "quartier": "Immo-Congo", "commune": "Kalamu", "rue": True},
    {"id": "croix_rouge", "scene": "v4rue_croix_rouge_gombe_b70", "quartier": "Croix-Rouge", "commune": "Gombe",
     "rue": True},
    {"id": "industriel", "scene": "v4_b21", "quartier": "Industriel", "commune": "Limete", "rue": False},
    {"id": "onl", "scene": "v4_b24", "quartier": "ONL", "commune": "Kasa-Vubu", "rue": False},
]

CHIPS = ["tuile", "sam3", "contexte", "hydro", "figure_fond"]
CLASSES = ["très faible", "faible", "moyen", "fort", "très fort"]

CELL_COLS = [
    "h3", "alea", "hand_m", "p_inond_composite", "risque", "emprise_bati", "densite_bat_ha", "part_road",
    "espace_ouvert", "imperv_micro", "part_bati_bas", "pop_ha", "n_bat", "n_enjeux", "n_ecole", "n_sante",
    "dist_sante_m", "dist_refuge_m", "argile_pct", "sable_pct", "cn_sec", "cn_moyen", "cn_humide", "cn_sol",
    "tissu_heuristique", "tissu_vlm", "densite_vlm", "materiaux_vlm", "voirie_vlm", "drainage_vlm", "indices_vlm",
    "capacites_vlm", "vuln_percue_vlm", "risque_percu_vlm", "a_verifier_vlm", "confiance_vlm", "incoherence_vlm",
    "avis_change_voisines", "vuln_percue_vlm_ciel", "n_photos_rue", "avis_change_rue", "exposition_m",
    "sensibilite_m", "capacite_m", "vuln_mesuree", "poids_vlm_effectif", "vulnerabilite_v4", "risque_v4",
    "classe_risque", "rang_risque_local", "incertitude_v4", "a_auditer_v4", "type_paysage",
]
BLD_COLS = ["hand_m", "classe_hauteur", "hauteur_ob_m", "surface_m2", "risque"]


def clean(v):
    """JSON-safe scalar."""
    if v is None:
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return None if math.isnan(v) else round(float(v), 4)
    if isinstance(v, str):
        return v if v not in ("", "nan", "None") else None
    return v


def round_coords(geom, nd=6):
    gj = geom.__geo_interface__

    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]

    return {"type": gj["type"], "coordinates": r(gj["coordinates"])}


def to_jpg(src, dst, size=384, q=78):
    im = Image.open(src).convert("RGB")
    im.thumbnail((size, size))
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "JPEG", quality=q, optimize=True)


# ----------------------------------------------------------------------------------------------- VLM readings
def parse_json(s):
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s or "", re.S)
        try:
            return json.loads(m.group(0)) if m else None
        except Exception:
            return None


def vlm_readings(jsonl, cells_h3):
    """Walk the VLM log in order. Returns {h3: {observation, sky, final, stages}}.
    'Décris…' = aerial observation, 'Interprète…' = interpretation (first one = sky reading), 'Relis…' = self-critique
    of the preceding interpretation. The last valid interpretation or critique is the final reading."""
    out = {h: {"observation": None, "sky": None, "final": None, "n_passes": 0} for h in cells_h3}
    if not jsonl.exists():
        return out
    current = None
    for line in jsonl.read_text(encoding="utf-8").splitlines():
        try:
            x = json.loads(line)
        except Exception:
            continue
        msg = x["messages"][-1]
        text = msg.get("content", "")
        hs = set(re.findall(r"(8a[0-9a-f]{13})", " ".join(msg.get("images", []))))
        rep = parse_json(x.get("reponse"))
        if text.startswith("Décris ce qui est visible") and hs:
            h = hs.pop()
            if h in out and rep:
                out[h]["observation"] = rep
        elif text.startswith("Interprète") and hs:
            current = hs.pop()
            if current in out and rep:
                if out[current]["sky"] is None:
                    out[current]["sky"] = rep
                out[current]["final"] = rep
                out[current]["n_passes"] += 1
        elif text.startswith("Relis") and current in out and rep:
            if out[current]["n_passes"] == 1 and out[current]["sky"] is not None:
                out[current]["sky"] = rep          # the sky reading includes its own critique
            out[current]["final"] = rep
    return out


# ----------------------------------------------------------------------------------------------- sky vs street
def sky_street(report, rue_dir):
    """Parse rapport_ciel_rue.html: per cell the sky / street / final table, street text, and the photo ids
    (embedded photos are matched byte-for-byte with rue/<id>.jpg)."""
    if not report.exists():
        return {}, []
    s = report.read_text(encoding="utf-8")
    by_hash = {}
    if rue_dir.exists():
        for p in rue_dir.glob("*.jpg"):
            by_hash[hashlib.md5(p.read_bytes()).hexdigest()] = p.stem
    # agreement table (first dataframe)
    agree = []
    t = re.search(r"<table border=\"1\" class=\"dataframe\">(.*?)</table>", s, re.S)
    if t:
        head = [re.sub(r"<.*?>", "", c).strip() for c in re.findall(r"<th>(.*?)</th>", t.group(1), re.S)]
        for row in re.findall(r"<tr>(.*?)</tr>", t.group(1), re.S):
            tds = [re.sub(r"<.*?>", "", c).strip() for c in re.findall(r"<td>(.*?)</td>", row, re.S)]
            if tds:
                agree.append(dict(zip(head, tds)))
    cards = {}
    for block in re.findall(r"<div class='f'>(.*?)</div>", s, re.S):
        h = re.search(r"<h3>(.*?)</h3>", block).group(1)
        photos = []
        for b64 in re.findall(r"data:image/jpeg;base64,([A-Za-z0-9+/=]+)", block):
            pid = by_hash.get(hashlib.md5(base64.b64decode(b64)).hexdigest())
            if pid:
                photos.append(pid)
        rows = []
        for row in re.findall(r"<tr><td>(.*?)</td><td>(.*?)</td><td>(.*?)</td><td>(.*?)</td></tr>", block):
            rows.append([clean(v) for v in row])
        street = re.search(r"<b>Rue</b> \((.*?)\) : (.*?)<br>", block, re.S)
        just = re.search(r"<b>Justification finale</b> : (.*?)</p>", block, re.S)
        cards[h] = {"photos": photos, "rows": rows,
                    "date": street.group(1) if street else None,
                    "street_text": street.group(2).strip() if street else None,
                    "justification": just.group(1).strip() if just else None}
    return cards, agree


# ----------------------------------------------------------------------------------------------- one run
def build_run(run, src, with_photos):
    scene = src / run["scene"]
    gpkg = scene / "agent" / "morpho_risque_v4.gpkg"
    c = gpd.read_file(gpkg, layer="cellules")
    b = gpd.read_file(gpkg, layer="batiments")
    utm = c.estimate_utm_crs()
    cu, bu = c.to_crs(utm), b.to_crs(utm)
    out_dir = SITE / "data" / run["id"]
    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "img").mkdir(parents=True)

    # population per cell exactly as restitution.scenario: pop_ha × projected area
    c["pop_cellule"] = (pd.to_numeric(c["pop_ha"], errors="coerce").fillna(0) * cu.geometry.area / 1e4).round(0)
    # buildings -> nearest cell (by centroid), as restitution.scenario
    j = gpd.sjoin_nearest(gpd.GeoDataFrame({"_i": range(len(bu))}, geometry=bu.geometry.centroid, crs=utm),
                          cu[["h3", "geometry"]], how="left").drop_duplicates("_i").set_index("_i").sort_index()
    b["h3"] = j["h3"].values

    readings = vlm_readings(scene / "agent" / "agent_v3_outputs.jsonl", list(c["h3"]))
    cards, agree = sky_street(scene / "agent" / "rapport_ciel_rue.html", scene / "rue") if run["rue"] else ({}, [])

    # images
    for h in c["h3"]:
        for k in CHIPS:
            p = scene / "chips" / f"{h}_{k}.png"
            if p.exists():
                to_jpg(p, out_dir / "img" / f"{h}_{k}.jpg")
    photo_files = {}
    if with_photos:
        for card in cards.values():
            for pid in card["photos"]:
                p = scene / "rue" / f"{pid}.jpg"
                if p.exists():
                    to_jpg(p, out_dir / "img" / f"rue_{pid}.jpg", size=640)
                    photo_files[pid] = f"rue_{pid}.jpg"
    planche = next((p for p in sorted((scene / "agent").glob("planche_*.png"))), None)
    if planche:
        to_jpg(planche, out_dir / "planche.jpg", size=1800, q=82)
    vue3d = scene / "agent" / "vue3d_scenario.html"
    if vue3d.exists():
        shutil.copy(vue3d, out_dir / "vue3d.html")

    # cells geojson
    feats = []
    for (_, r), (_, ru) in zip(c.iterrows(), cu.iterrows()):
        props = {k: clean(r[k]) for k in CELL_COLS if k in c.columns}
        props["pop_cellule"] = clean(r["pop_cellule"])
        props["aire_m2"] = round(ru.geometry.area)
        rd = readings.get(r["h3"], {})
        props["vlm"] = {"observation": rd.get("observation"), "sky": rd.get("sky"), "final": rd.get("final")}
        props["chips"] = [k for k in CHIPS if (out_dir / "img" / f"{r['h3']}_{k}.jpg").exists()]
        if r["h3"] in cards:
            cd = dict(cards[r["h3"]])
            cd["photo_files"] = [photo_files.get(p) for p in cd["photos"]]
            props["street"] = cd
        feats.append({"type": "Feature", "properties": props, "geometry": round_coords(r.geometry)})
    bfeats = [{"type": "Feature", "properties": {**{k: clean(r[k]) for k in BLD_COLS if k in b.columns},
                                                   "h3": r["h3"]},
               "geometry": round_coords(r.geometry)} for _, r in b.iterrows()]

    # KPIs (same definitions as morpho_risque.validation)
    read = c[c["tissu_vlm"].notna()]
    def rho(col):
        if col not in c or c[col].notna().sum() < 5 or c[col].nunique() < 2:
            return None
        res = spearmanr(c["risque_v4"], c[col], nan_policy="omit")
        return {"rho": clean(res.statistic), "p": clean(res.pvalue)}
    fiab = (c["poids_vlm_effectif"] / (0.3 * c["confiance_vlm"])).replace([np.inf, -np.inf], np.nan)
    kpi = {
        "area_km2": round(cu.union_all().area / 1e6, 2),
        "cells": len(c), "cells_read": len(read), "buildings": len(b),
        "population": int(c["pop_cellule"].sum()),
        "fabric_agreement": clean((read["tissu_vlm"] == read["tissu_heuristique"]).mean()) if len(read) else None,
        "incoherent": int(read.get("incoherence_vlm", pd.Series(dtype=str)).fillna("").ne("").sum()),
        "audit_share": clean(c["a_auditer_v4"].mean()), "audit_n": int(c["a_auditer_v4"].sum()),
        "rho_observed": rho("p_inond_composite"), "rho_v3": rho("risque"),
        "vlm_reliability": clean(fiab.median()) if fiab.notna().any() else None,
        "changed_by_neighbours": int(c.get("avis_change_voisines", pd.Series(dtype=float)).fillna(False).astype(bool).sum()),
        "street_cells": int(c["n_photos_rue"].notna().sum()) if "n_photos_rue" in c else 0,
        "changed_by_street": int(c.get("avis_change_rue", pd.Series(dtype=float)).fillna(False).astype(bool).sum()),
        "classes": {k: int((c["classe_risque"] == k).sum()) for k in CLASSES},
        "low_buildings": int((b["classe_hauteur"] == "bas").sum()),
    }
    minx, miny, maxx, maxy = c.total_bounds
    data = {"run": run, "bounds": [[miny, minx], [maxy, maxx]], "kpi": kpi, "agreement": agree,
            "has_vue3d": vue3d.exists(), "has_planche": planche is not None,
            "cells": {"type": "FeatureCollection", "features": feats},
            "buildings": {"type": "FeatureCollection", "features": bfeats}}
    js = f"window.RUNS=window.RUNS||{{}};window.RUNS[{json.dumps(run['id'])}]=" + \
         json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    (out_dir / "data.js").write_text(js, encoding="utf-8")
    size = sum(p.stat().st_size for p in out_dir.rglob("*") if p.is_file()) / 1e6
    print(f"{run['id']:12s} {len(c):3d} cells {len(b):4d} bldgs  pop {kpi['population']:6d}  "
          f"agree {kpi['fabric_agreement']}  rho_obs {kpi['rho_observed']}  audit {kpi['audit_share']}  "
          f"street cards {len(cards)}  {size:.1f} MB")
    return {**{k: run[k] for k in ("id", "quartier", "commune", "rue")}, "kpi": kpi}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="D:/SAM3hybrid/outputs")
    ap.add_argument("--with-photos", action="store_true")
    a = ap.parse_args()
    index = [build_run(r, Path(a.src), a.with_photos) for r in RUNS]
    (SITE / "data" / "index.js").write_text(
        "window.RUN_INDEX=" + json.dumps(index, ensure_ascii=False) + ";", encoding="utf-8")


if __name__ == "__main__":
    main()
