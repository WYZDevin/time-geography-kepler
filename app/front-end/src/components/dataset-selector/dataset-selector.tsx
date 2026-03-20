import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../stores/store';
import { selectAllDataSources } from '../../stores/data-slice';

interface DatasetSelectorProps {
    value?: string;
    onChange: (datasetId: string) => void;
    placeholder?: string;
    required?: boolean;
    className?: string;
}

const DatasetSelector: React.FC<DatasetSelectorProps> = ({
    value,
    onChange,
    placeholder = "Select a dataset...",
    required = false,
    className = ""
}) => {
    const dataSources = useSelector((state: RootState) => selectAllDataSources(state));

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedValue = event.target.value;
        onChange(selectedValue);
    };

    return (
        <select
            value={value || ''}
            onChange={handleChange}
            className={`w-full p-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${className}`}
            required={required}
        >
            <option value="" disabled={required}>
                {placeholder}
            </option>
            {dataSources.map((dataSource) => (
                <option key={dataSource.id} value={dataSource.id}>
                    {dataSource.name} ({dataSource.featureCount} features)
                </option>
            ))}
        </select>
    );
};

export default DatasetSelector;