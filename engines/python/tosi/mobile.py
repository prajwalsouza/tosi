"""New foreign land mobile stations. See spec/stages/mobile/README.md."""
from .terra_common import emit, need_terrestrial, open_db, round3, rulebook, stations, write_result

FIELDS = ["terrakey", "adm", "cls", "f_mhz", "lon", "lat", "reason"]


def run(folder):
    intake = need_terrestrial(folder)
    rules, stamp = rulebook("mobile")
    emit("mobile", "start")
    all_stations = stations(open_db(folder), "mobile")
    left = dict.fromkeys(rules["reasons"], 0)
    notices = []
    for s in all_stations:
        reason = ("recorded" if s["stage"] != rules["notice_stage"] else "finnish" if s["adm"] == rules["own_administration"]
                  else "not_land_mobile" if s["cls"] not in rules["classes"] else None)
        if reason:
            left[reason] += 1
        notices.append([s["terrakey"], s["adm"], s["cls"], s["f"], None if s["lon"] is None else round3(s["lon"]),
                        None if s["lat"] is None else round3(s["lat"]), reason])
    kept = sum(n[6] is None for n in notices)
    result = {"schema": "mobile/1", "rulebook": stamp, "file": intake["file"]["sha256"],
              "counts": {"notices": len(notices), "kept": kept, "left": left}, "fields": FIELDS, "notices": notices}
    emit("mobile", "done", kept=kept, notices=len(notices), left=left)
    return write_result(folder, "mobile", result)
