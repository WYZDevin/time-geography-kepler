
import { processGeojson } from '@kepler.gl/processors';
import { useDropzone } from 'react-dropzone';
import React, { useState } from 'react';
import { FeatureCollection } from '../../interfaces/data-interfaces';
import { Field } from '@kepler.gl/types';
import FileForm from './file-field-form';
import FileUploader from './file-uploader';
import { Button } from '@/components/ui/button';


export const ControlPanel = () => {
    const [processedGeoData, setProcessedGeoData] = useState(null);
    const [rawGeoData, setRawGeoData] = useState<FeatureCollection | null>(null);
    const [fields, setFields] = useState<Field[]>([]);
    const [isFileSelected, setIsFileSelected] = useState(false);
    
    const handleFileLoaded = (rawData: FeatureCollection) => {
        const processedData = processGeojson(rawData);
        if (processedData) {
            setProcessedGeoData(processedData as any);
            setRawGeoData(rawData);
            setFields(processedData.fields);
            setIsFileSelected(true);
        }
    };

    const resetMainPanel = () => {
        setProcessedGeoData(null);
        setRawGeoData(null);
        setFields([]);
        setIsFileSelected(false);
    }

    return (
        <div className='flex flex-col gap-4 h-full'>
            {isFileSelected ? (
                <FileForm rawGeoData={rawGeoData} fields={fields} />
            ) : (
                <FileUploader onFileLoaded={handleFileLoaded} />
            )}
            {isFileSelected && (
                <Button onClick={resetMainPanel}>Reset Input</Button>
            )}
        </div>
    )
}