import { FeatureCollection } from "@/interfaces/data-interfaces";
import React from "react";
import { useDropzone } from "react-dropzone";

const FileUploader = ({ onFileLoaded }: { onFileLoaded: (rawData: FeatureCollection) => void }) => {
    const processFile = (file: File) => {
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const result = JSON.parse(e.target?.result as string);
                    onFileLoaded(result);
                } catch (err) {
                    console.error('Invalid file:', err);
                }
            };
            reader.readAsText(file);
        }
    };

    const onDrop = React.useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        processFile(file);
    }, [processFile]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/json': ['.json', '.geojson'],
        },
        multiple: false,
        noClick: false,
        noKeyboard: false,
        preventDropOnDocument: true
    });

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            processFile(file);
        }
    };

    return (
        <div
            {...getRootProps()}
            className={`p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'} h-full`}
        >
            <input {...getInputProps()} onChange={handleInputChange} />
            {isDragActive ? (
                <p className="text-blue-500">Drop the GeoJSON file here...</p>
            ) : (
                <div>
                    <p className="text-gray-600">Drag and drop a GeoJSON file here, or click to select file</p>
                    <p className="text-sm text-gray-400 mt-2">Accepts .geojson and .json files</p>
                </div>
            )}
        </div>
    );
};

export default FileUploader;