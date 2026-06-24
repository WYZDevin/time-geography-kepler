# Getting Started

This page takes you from nothing installed to your **first space-time analysis**.
You run the whole platform with **Docker** — one free app to install and two
copy-paste commands. **No download, no coding, and no programming knowledge is
required.**

The path is four steps:

1. **[Install Docker Desktop](#step-1-—-install-docker-desktop)** — the free app that runs everything for you.
2. **[Start the app](#step-2-—-start-the-app)** — launch the two ready-made images.
3. **[Open it](#step-3-—-open-the-app-in-your-browser)** in your browser.
4. **[Run your first analysis](#step-4-—-run-your-first-space-time-analysis)** on a sample trajectory.

Everything after Step 4 — starting and stopping, updating, building from source,
and troubleshooting — is reference you can come back to later.

## Step 1 — Install Docker Desktop

Docker is a free program that runs Time Geography Kepler for you, so you don't
have to install anything else.

1. Go to **<https://www.docker.com/products/docker-desktop/>**.
2. Download **Docker Desktop** for your system (Windows, Mac, or Linux) and
   install it like any other app.
3. **Open Docker Desktop** and wait until it says **"Docker Desktop is running"**
   (you'll see a small whale icon in your menu bar / system tray).

::: warning Keep Docker open
Docker Desktop must be **running** every time you start the app. If it's closed,
the commands in Step 2 will fail with a "cannot connect" error — just open Docker
Desktop and try again.
:::

## Step 2 — Start the app

The app is published ready-made on Docker Hub, so **you don't need to download
anything**. Pick whichever way you prefer — both do exactly the same thing.

### Option A — Right inside Docker Desktop (no terminal)

You can pull and start both parts without typing a single command:

1. Open **Docker Desktop** and click the **search bar** at the very top.
2. Type **`yongzwu/time-geography-backend`**, then click **Pull** on the matching
   image.
3. Search again for **`yongzwu/time-geography-frontend`** and **Pull** it too.
4. Click the **Images** tab on the left. Next to **time-geography-backend**, press
   the **Run** (▶) button. In the pop-up, open **Optional settings** and fill in:
   - **Container name:** `tgk-backend`
   - **Host port:** `8000`

   Then click **Run**.
5. Do the same for **time-geography-frontend**, but use:
   - **Container name:** `tgk-frontend`
   - **Host port:** `5173`

Both parts now appear under the **Containers** tab with a green **Running**
status. (Later, you start and stop them with the **▶ / ■** buttons there — no need
to repeat this setup.)

### Option B — Two commands (fastest)

::: details How do I open a terminal?
- **Windows:** click **Start**, type `powershell`, press Enter.
- **Mac:** press **Cmd + Space**, type `Terminal`, press Enter.
- **Linux:** open your **Terminal** app.

You can open it **anywhere** — these commands don't depend on any folder.
:::

Copy each line, paste it, and press Enter (run them one at a time):

```bash
docker run -d --name tgk-backend -p 8000:8000 yongzwu/time-geography-backend:latest
docker run -d --name tgk-frontend -p 5173:80 yongzwu/time-geography-frontend:latest
```

Each command prints a long line of letters and numbers when it works — that part
is now running in the background.

::: tip First time is slower
Whichever option you pick, the **first** start downloads the app (a few minutes,
depending on your internet speed). That's normal, and it's instant every time
after. If you ever see **"name is already in use"**, the app is already
installed — just press **▶ Start** in the **Containers** tab instead.
:::

## Step 3 — Open the app in your browser

Go to:

### 👉 <http://localhost:5173>

You should see the **Space-Time Analytics Platform** home screen. That's it — the
app is running on your own computer.

![Initial page](/getting-started/initial-page.png)

## Step 4 — Run your first space-time analysis

Now turn that running app into a real result. A **space-time analysis** plots your
movement data in 3D, where height — the **Z axis** — is **time**, so a trajectory
climbs as the day goes on.

1. **Load a trajectory.** Open the **Data** panel and choose **Upload → CSV
   File**. Don't have data yet? Download this small sample first, then upload it:
   [day3_2026-06-13.csv](https://github.com/WYZDevin/time-geography-kepler/raw/main/demo-datasets/individual/day3_2026-06-13.csv)
   — one real person's GPS trace for a single day (June 13, 2026; ~800 points, a
   clean home → activity → home round trip). In the **Map Coordinate Columns**
   step, the **longitude**, **latitude**, and **altitude** columns are detected
   automatically — just confirm and finish.
2. **Pick a tool.** On the **Select Analysis Tool** screen, choose **3D
   Trajectory** — the simplest space-time view and the best place to start.
3. **Check the Datetime Column.** The app auto-detects the time column — `dataTime`
   in this sample — and pre-fills it, so you can leave it as-is. The time axis
   depends on this field, so if it's ever empty, pick the column holding your
   timestamps.
4. **Run & explore.** Click **Run Analysis**, then **drag to rotate** the map so
   the vertical time axis comes into view. Hover any point to read its values.

🎉 That's a complete space-time analysis. From here, try the analytical tools —
[Space-Time Kernel Density](/tools/stkde), [Space-Time Cube](/tools/space-time-cube),
and [Space-Time Prism](/tools/space-time-prism) — or read the full
[Running an Analysis](/guide/workflow) walkthrough.

---

## Managing the app

Once you've run your first analysis, here's how to keep the app running day to day.

### Start, stop, and restart

**The easy way (Docker Desktop):** open **Docker Desktop** and click the
**Containers** tab on the left. You'll see **tgk-frontend** and **tgk-backend**,
each showing a green **Running** status. With no typing, you can:

- Click the **`5173:80`** port link next to **tgk-frontend** to open the app.
- Press **Stop** (■) to shut a part down, and **Start** (▶) to run it again later.
- Click a container to watch its logs if something looks wrong.

**From the terminal:**

```bash
docker stop tgk-frontend tgk-backend     # stop the app
docker start tgk-frontend tgk-backend    # start it again later
```

### Update to the latest version

To pick up the newest release, download fresh images and recreate the app:

```bash
docker pull yongzwu/time-geography-backend:latest
docker pull yongzwu/time-geography-frontend:latest
docker rm -f tgk-backend tgk-frontend
```

Then run the two commands from **Step 2** again.

### Advanced: run from the source code

Prefer to build it yourself — for example, to change the code? Get the project and
use Docker Compose instead:

1. Open **<https://github.com/WYZDevin/time-geography-kepler>**, click the green
   **`<> Code`** button → **Download ZIP**, and unzip it.
2. Open a terminal **inside** the unzipped folder.
3. Run one of:

   ```bash
   docker compose -f docker-compose.prod.yml up   # pull the ready-made images
   docker compose up --build                       # build from your local code
   ```

The app opens at the same address: <http://localhost:5173>.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| **"Cannot connect to the Docker daemon"** | Docker Desktop isn't running — open it, wait for "Docker Desktop is running", then try Step 2 again. |
| **The command isn't found** (`docker: command not found`) | Docker Desktop isn't installed correctly — reinstall it (Step 1) and restart your computer. |
| **"name is already in use"** | You already set the app up. Don't re-run the commands — press **▶ Start** in Docker Desktop, or remove the old containers with `docker rm -f tgk-backend tgk-frontend` and run Step 2 again. |
| **First start is slow / stuck on downloads** | The first run downloads the app — a few minutes is normal. Let it finish; later starts are instant. |
| **Nothing loads at `localhost:5173`** | Give it a few seconds after Step 2, check both parts show **Running** in Docker Desktop, then refresh the browser. |
| **"Port is already in use"** | Another program is using port 5173 or 8000. Close it (or restart your computer), then try Step 2 again. |
