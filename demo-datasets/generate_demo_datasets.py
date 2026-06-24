#!/usr/bin/env python3
"""
Generate time-geography demo datasets from the raw year-long GPS log.

Source: 2026.01.01-2026.12.31.csv  (one real person, 157 days, multi-city).
The dominant base is the Toronto / GTA metro (~141 of 157 days); the rest are
travel days (Tokyo, SF Bay, Shenzhen, ...) which we ignore here.

Produces:
  1. Three single-day "individual" datasets — representative full days, used
     as-is (real coordinates, real timestamps, original column   schema).
  2. One 30-user "multi-user" dataset — 30 clean home-anchored days, each turned
     into a synthetic user by:
       - translating the whole day so its real home maps onto a FAKE home
         scattered realistically across the real Toronto metro (privacy +
         distinct users), preserving movement shape / distance / time-of-day;
       - re-basing timestamps onto one shared reference day (keeping each
         point's real time-of-day) so all 30 paths stack over a single 24h
         Z-axis in the 3D trajectory view;
       - adding a `user_id` column (select it as the "User ID Column" in the
         3D Trajectory tool).

Re-run:  python3 demo-datasets/generate_demo_datasets.py
Deterministic (fixed RNG seed) — same input always yields the same output.
"""
import csv
import datetime
import collections
import math
import random
import os

SRC = "2026.01.01-2026.12.31.csv"
OUT = "demo-datasets"
TZ = datetime.timedelta(hours=-5)            # Toronto local (EST)
HOME = (-79.646, 43.585)                      # detected real night-time home (lon, lat)
REF_DATE = datetime.date(2026, 6, 15)         # shared reference day for multi-user
REP_DAYS = ["2026-02-21", "2026-04-11", "2026-06-13"]
N_USERS = 30

# Real GTA municipality centres (lon, lat) — all on land, used as realistic
# scatter anchors for the faked homes (each home = an anchor + small jitter).
GTA_ANCHORS = [
    (-79.383, 43.653),  # Toronto downtown
    (-79.413, 43.770),  # North York
    (-79.258, 43.773),  # Scarborough
    (-79.567, 43.643),  # Etobicoke
    (-79.644, 43.589),  # Mississauga
    (-79.762, 43.731),  # Brampton
    (-79.337, 43.857),  # Markham
    (-79.440, 43.882),  # Richmond Hill
    (-79.508, 43.837),  # Vaughan
    (-79.687, 43.467),  # Oakville
    (-79.087, 43.838),  # Pickering
    (-79.020, 43.851),  # Ajax
    (-79.461, 44.056),  # Newmarket
    (-78.866, 43.897),  # Oshawa
    (-79.799, 43.325),  # Burlington
]


def local(ts):
    return datetime.datetime.utcfromtimestamp(int(ts)) + TZ


def meters(lat, dlon, dlat):
    return math.hypot(dlon * 111320 * math.cos(math.radians(lat)), dlat * 110540)


def in_toronto(lo, la):
    return -81 < lo < -78 and 43 < la < 45


def load():
    with open(SRC, newline="") as f:
        rd = csv.DictReader(f)
        fields = rd.fieldnames
        rows = list(rd)
    by_day = collections.defaultdict(list)
    for r in rows:
        by_day[local(r["dataTime"]).date()].append(r)
    for d in by_day:
        by_day[d].sort(key=lambda r: int(r["dataTime"]))
    return fields, by_day


def is_clean_home_day(rs):
    """Full day that starts and ends at home and stays within the Toronto metro."""
    lo = [float(r["longitude"]) for r in rs]
    la = [float(r["latitude"]) for r in rs]
    ts = [int(r["dataTime"]) for r in rs]
    if not all(in_toronto(x, y) for x, y in zip(lo, la)):
        return False
    sh = meters(HOME[1], lo[0] - HOME[0], la[0] - HOME[1])
    eh = meters(HOME[1], lo[-1] - HOME[0], la[-1] - HOME[1])
    maxd = max(meters(HOME[1], x - HOME[0], y - HOME[1]) for x, y in zip(lo, la)) / 1000
    span_h = (ts[-1] - ts[0]) / 3600
    return sh < 300 and eh < 400 and span_h >= 8 and len(rs) >= 120 and maxd > 2


def write_csv(path, fields, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def day_home_anchor(rs):
    """Centroid of the day's points within 400 m of the real home (its rest cluster)."""
    near = [(float(r["longitude"]), float(r["latitude"])) for r in rs
            if meters(HOME[1], float(r["longitude"]) - HOME[0],
                      float(r["latitude"]) - HOME[1]) < 400]
    if not near:
        near = [(float(rs[0]["longitude"]), float(rs[0]["latitude"]))]
    return (sum(p[0] for p in near) / len(near), sum(p[1] for p in near) / len(near))


def main():
    fields, by_day = load()
    os.makedirs(os.path.join(OUT, "individual"), exist_ok=True)

    # ---- 1. Representative individual days (untouched real data) ----------
    for i, ds in enumerate(REP_DAYS, 1):
        d = datetime.date.fromisoformat(ds)
        rows = by_day[d]
        write_csv(os.path.join(OUT, "individual", f"day{i}_{ds}.csv"), fields, rows)
        print(f"[individual] day{i}_{ds}.csv  rows={len(rows)}")

    # ---- 2. Pick 30 richest clean home-anchored days (excluding reps) ------
    rep_set = {datetime.date.fromisoformat(d) for d in REP_DAYS}
    clean = [(d, rs) for d, rs in by_day.items()
             if d not in rep_set and is_clean_home_day(rs)]
    clean.sort(key=lambda x: -len(x[1]))
    chosen = clean[:N_USERS]

    # ---- Scatter 30 fake homes across the real metro (seeded) -------------
    rng = random.Random(42)
    anchors = GTA_ANCHORS * 2
    rng.shuffle(anchors)
    fake_homes = [(lo + rng.uniform(-0.02, 0.02), la + rng.uniform(-0.02, 0.02))
                  for lo, la in anchors[:N_USERS]]

    ref_mid = datetime.datetime(REF_DATE.year, REF_DATE.month, REF_DATE.day)
    mu_fields = fields + ["user_id"]
    mu_rows = []
    for idx, (d, rs) in enumerate(chosen):
        uid = f"user_{idx + 1:02d}"
        anc = day_home_anchor(rs)
        fh = fake_homes[idx]
        dlon, dlat = fh[0] - anc[0], fh[1] - anc[1]      # translate home -> fake home
        day_shift = (REF_DATE - d).days * 86400          # re-base to shared day
        for r in rs:
            nr = dict(r)
            nr["longitude"] = f"{float(r['longitude']) + dlon:.6f}"
            nr["latitude"] = f"{float(r['latitude']) + dlat:.6f}"
            nr["dataTime"] = str(int(r["dataTime"]) + day_shift)
            nr["user_id"] = uid
            mu_rows.append(nr)
        print(f"[multi-user] {uid}  {d}  rows={len(rs)}  fake_home=({fh[0]:.4f},{fh[1]:.4f})")

    mu_rows.sort(key=lambda r: (r["user_id"], int(r["dataTime"])))
    write_csv(os.path.join(OUT, "multi-user_30users.csv"), mu_fields, mu_rows)
    print(f"\n[multi-user] multi-user_30users.csv  users={N_USERS}  rows={len(mu_rows)}")
    print(f"  ref day={REF_DATE}  (all users re-based to this date, time-of-day preserved)")


if __name__ == "__main__":
    main()
