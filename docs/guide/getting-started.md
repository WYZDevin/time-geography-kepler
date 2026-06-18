# Getting Started

You can run the whole platform with **Docker** — one free app to install and two
copy-paste commands. **No download, no coding, and no programming knowledge is
required.**

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

## See and control it in Docker Desktop

You don't have to live in the terminal. Open **Docker Desktop** and click the
**Containers** tab on the left. You'll see **tgk-frontend** and **tgk-backend**,
each showing a green **Running** status.

From here, with no typing, you can:

- Click the **`5173:80`** port link next to **tgk-frontend** to open the app in
  your browser.
- Press the **Stop** (■) button to shut a part down.
- Press **Start** (▶) later to run it again.
- Click a container to watch its logs if something looks wrong.

## Stopping and restarting

**The easy way (Docker Desktop):** open **Containers** and press **Stop** (■) on
**tgk-frontend** and **tgk-backend**. Press **Start** (▶) when you want them back.

**From the terminal:**

```bash
docker stop tgk-frontend tgk-backend     # stop the app
docker start tgk-frontend tgk-backend    # start it again later
```

## Updating to the latest version

To pick up the newest release, download fresh images and recreate the app:

```bash
docker pull yongzwu/time-geography-backend:latest
docker pull yongzwu/time-geography-frontend:latest
docker rm -f tgk-backend tgk-frontend
```

Then run the two commands from **Step 2** again.

## Your first analysis

1. Click **Data → Upload** and load a trajectory file. Don't have one? Download
   this small sample first:
   [sample-trajectory.geojson](https://github.com/WYZDevin/time-geography-kepler/raw/main/app/front-end/e2e/fixtures/sample-trajectory.geojson).
2. Pick a tool — start with **3D Trajectory**.
3. Map the **Datetime Column** to your timestamp field (in the sample it's
   `timestamp`).
4. Click **Run Analysis** and explore the 3D result.

Full walkthrough: [Running an Analysis](/guide/workflow).

## Advanced: run from the source code

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
