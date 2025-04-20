import { useEffect } from 'react';
import KeplerGl from '@kepler.gl/components';
import { ControlPanel } from './components/main-panel/control-panel';
import ProgressDialog from './components/custom-components/progress-bar';
import { progressService } from './components/custom-components/progress-bar';

const App = () => {
  // State to hold the processed data and the extracted fields

  const keplerWidth = window.innerWidth * 0.7;
  const keplerHeight = window.innerHeight - 80; // Reduced height to accommodate header
  // Callback when file is loaded and processed 

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Clean up any pending progress operations
      progressService.reset();
    };
  }, []);

  const white = '#ffffff';
  const customTheme = {
    sidePanelBg: white,
    titleTextColor: '#000000',
    sidePanelHeaderBg: '#f7f7F7',
    subtextColorActive: '#2473bd',
    backgroundColor: white
  };

  return (
    <>
      {/* Horizontal header across the top of the page */}
      <header className="w-full bg-gradient-to-r from-blue-600 to-indigo-800 text-white p-3 shadow-md flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-xl font-bold mr-4">Placeholder</h1>
          <span className="text-sm border-l border-white/30 pl-4">Analyzing, visualizing, and exploring space-time data</span>
        </div>
        <div className="flex items-center text-sm">
          <span className="mr-4">v0.0.1</span>

          <span>Created by </span>
          <img src={'/gispark.png'} alt="GISPark" className="h-10 mr-2" />
        </div>
      </header>

      <div className="grid grid-cols-[70%_30%] h-[calc(100vh-60px)] w-full overflow-hidden">
        <ProgressDialog />
        {/* Left side: Kepler.gl container using 70% of the width */}
        <div className="relative h-full">
          <div className="absolute top-4 left-0 w-full h-full">
          <KeplerGl
            width={keplerWidth}
            height={keplerHeight}
            id="kepler"
            mapboxApiAccessToken=""
            theme="light"
            mapStyle={{
              styleType: 'light',
            }}
            // add 16 px padding to the top of the map

            // mapStyle={{
            //   version: 8,
            //   sources: {
            //     'osm-tiles': {
            //       type: 'raster',
            //       tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            //       tileSize: 256,
            //       attribution: '&copy; OpenStreetMap contributors',
            //     },
            //   },
            //   layers: [
            //     {
            //       id: 'osm-tiles',
            //       type: 'raster',
            //       source: 'osm-tiles',
            //     },
            //   ],
            // }}
          />
          </div>
        </div>

        {/* Right side: File uploader with a background */}
        <div className="bg-grey p-4 h-full overflow-auto">
          <ControlPanel />
        </div>
      </div>

      {/* Modal to select the latitude, longitude, and time fields */}
    </>
  );
};

export default App;
