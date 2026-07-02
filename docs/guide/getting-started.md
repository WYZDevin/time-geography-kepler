# Getting Started

This guide goes from a fresh computer to a first space-time analysis. The
easiest setup uses **Docker Desktop**, which runs the frontend and backend for
you — no Python, Node.js, or GIS install required.

## Step 1 — Install Docker Desktop

1. Download **Docker Desktop** from
   <https://www.docker.com/products/docker-desktop/> (Windows, Mac, or Linux)
   and install it.
2. Open Docker Desktop and wait until it says **"Docker Desktop is running"**.

::: warning Keep Docker open
Docker Desktop must be running whenever you start the app. If it is closed, the
commands in Step 2 fail with a "cannot connect" error.
:::

## Step 2 — Start the app

The app is published as two ready-made Docker images. Pick either option; both
start the same frontend and backend.

### Option A — Inside Docker Desktop (no terminal)

1. In Docker Desktop, use the **search bar** at the top to find
   **`yongzwu/time-geography-backend`** and click **Pull**.
2. Search for **`yongzwu/time-geography-frontend`** and **Pull** it too.
3. In the **Images** tab, press **Run** (▶) next to **time-geography-backend**.
   Under **Optional settings**, set:
   - **Container name:** `tgk-backend`
   - **Host port:** `8000`
4. Do the same for **time-geography-frontend** with:
   - **Container name:** `tgk-frontend`
   - **Host port:** `5173`

Both containers now show as **Running** under the **Containers** tab, where you
can start and stop them later.

### Option B — Two commands

::: details How do I open a terminal?
- **Windows:** click **Start**, type `powershell`, press Enter.
- **Mac:** press **Cmd + Space**, type `Terminal`, press Enter.
- **Linux:** open your **Terminal** app.

The commands work from any folder.
:::

Run these one at a time:

```bash
docker run -d --name tgk-backend -p 8000:8000 yongzwu/time-geography-backend:latest
docker run -d --name tgk-frontend -p 5173:80 yongzwu/time-geography-frontend:latest
```

Each command prints a container ID when it succeeds.

::: tip First start is slower
The first start downloads the images and can take a few minutes. If you see
**"name is already in use"**, the container already exists — start it from the
**Containers** tab instead.
:::

## Step 3 — Open the app

Go to <http://localhost:5173>. You should see the **Space-Time Analytics
Platform** home screen.

![Initial page](/getting-started/initial-page.png)

## Step 4 — Run your first space-time analysis

Using one bundled sample dataset, first visualize a GPS trajectory in 3D, then
build a Space-Time Prism from it.

### Visualize the trajectory in 3D

1. **Load a trajectory.** Download
   <a href="/time-geography-kepler/example_1.csv" download="example_1.csv">example_1.csv</a>
   — one person's GPS trace for a single day (~800 points, a
   home → activity → home trip). Open the **Data** panel, choose
   **Upload → CSV File**, and upload it. In the **Map Coordinate Columns**
   step, the **longitude**, **latitude**, and **altitude** columns are detected
   automatically; confirm and finish.

   ![Upload data](/getting-started/data-source.png)
   ![Map columns](/getting-started/map-columns.png)

2. **Pick a tool.** On the **Select Analysis Tool** screen, choose
   **3D Trajectory**.

   ![Select the 3D Trajectory tool](/getting-started/select-tool.png)

3. **Check the datetime column.** The app auto-detects `dataTime` in this
   sample, so leave it as-is. This field defines the vertical time axis; for
   your own data, choose the column that stores timestamps.

   ![Check the datetime column](/getting-started/tool-setting.png)

4. **Run and explore.** Click **Run Analysis**, then **right-click and drag**
   to rotate the map until the vertical time axis comes into view. Hover any
   point to read its values.

   ![Visualized trajectory](/getting-started/visualized-trajectory.png)

### Build a Space-Time Prism

1. **Set the anchors.** Click the home location on the map to drop the
   **start anchor**, then click one of the stays to drop the **end anchor**.
   The prism will show the space-time region the person could have reached
   between these two points.

   ![Select the home location as the start anchor](/getting-started/select-home-anchor.png)
   ![Select an activity stay as the end anchor](/getting-started/select-end-anchor.png)

2. **Configure.** Click **Build Space-Time Prism**; the settings panel opens on
   the right. This example uses a **60 km/h** travel speed with **Free-flow**
   speed realism. To approximate the user's actual travel speed instead, switch
   **Speed Realism** to **Auto**.

   ![Space-Time Prism settings](/getting-started/stp-tool-setting.png)

3. **Run.** Click **Run**. Computation takes from under a minute to several
   minutes depending on the anchor area and settings. When it finishes, a heat
   map of potential dwell time appears alongside a 3D prism view.

   ![Space-Time Prism result](/getting-started/stp-result.png)

4. **Take a closer look.** Click **Focused 3D View** at the bottom-left of the
   map. It zooms in on the prism and shows the potential path area at each time
   slice between the anchors. Right-click and drag to change the viewing angle,
   or press play to animate the prism over time.

   ![Focused 3D View](/getting-started/stp-focused.png)

From here, try the other tools:
[Space-Time Kernel Density](/tools/stkde) and
[Space-Time Cube](/tools/space-time-cube).
