import { useEffect } from 'react';
import KeplerGl from '@kepler.gl/components';
import { ControlPanel } from './components/main-panel/control-panel';
import ProgressDialog from './components/custom-components/progress-bar';
import { progressService } from './components/custom-components/progress-bar';

const App = () => {
  // State to hold the processed data and the extracted fields

  const keplerWidth = window.innerWidth * 0.7;
  const keplerHeight = window.innerHeight;
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
      <div className="grid grid-cols-[70%_30%] h-screen w-full overflow-hidden">
        <ProgressDialog />
        {/* Left side: Kepler.gl container using 70% of the width */}
        <div className="relative h-full">
          <KeplerGl
            width={keplerWidth}
            height={keplerHeight}
            id="kepler"
            mapboxApiAccessToken="pk.eyJ1IjoiZGV2aW53eXoiLCJhIjoiY203bGFrbG0wMDZqMDJrb2t6aDk0aXd0ZSJ9.HB2is1fGpx-n1fM05YzDLg"
            theme="light"
            mapStyle={{
              styleType: 'light',
            }}
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
