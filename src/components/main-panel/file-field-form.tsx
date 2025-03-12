import React, { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
// Import shadcn/ui form and select components
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
} from '@/components/ui/form';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { addDataToKeplerWithTime, findCoordinateAndTimeColumns } from '@/data-processors/data-handler';
import { Field } from '@kepler.gl/types';
import MultipleSelector, { Option } from '@/components/ui/multiple-selector';
import { getUniqueValuesFromGeoJSON } from '@/data-processors/data-preprocessing';
import { fileFormSchema, FileFormValues } from '@/interfaces/data-interfaces';

type FileFormProps = {
  rawGeoData: any;
  fields: Field[];
};


const FileForm: React.FC<FileFormProps> = ({ rawGeoData, fields }) => {
  const form = useForm<FileFormValues>({
    resolver: zodResolver(fileFormSchema),
    defaultValues: {  
      latitude: '',
      longitude: '',
      time: '',
      // altitude: '',
      visualizeActivitySpace: false,
      activitySpaceField: '',
      activitySpaceValues: [],
    },
  });

  const { control, handleSubmit, reset, formState: { errors } } = form;

  // Set default values based on the available fields
  useEffect(() => {
    const featureNames = fields.map(field => field.name);
    const { longitude, latitude, altitude, time } = findCoordinateAndTimeColumns(featureNames);
    reset({
      latitude: latitude || '',
      longitude: longitude || '',
      time: time || '',
      // altitude: altitude || '',
      visualizeActivitySpace: false,
      activitySpaceField: '',
      activitySpaceValues: [],
    });
  }, [fields, reset]);

  const onSubmit = (data: FileFormValues) => {
    // Call your helper function with the raw geo data, form values, and fields
    addDataToKeplerWithTime(rawGeoData, data);
  };


  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Latitude Field */}
        <FormField
          control={control}
          name="latitude"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Latitude</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((option: Field) => (
                      <SelectItem key={option.name} value={option.name}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              {errors.latitude && (
                <p className="text-red-500 text-sm">{errors.latitude.message}</p>
              )}
            </FormItem>
          )}
        />
        {/* Longitude Field */}
        <FormField
          control={control}
          name="longitude"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Longitude</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((option: Field) => (
                      <SelectItem key={option.name} value={option.name}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              {errors.longitude && (
                <p className="text-red-500 text-sm">{errors.longitude.message}</p>
              )}
            </FormItem>
          )}
        />
        {/* Time Field */}
        <FormField
          control={control}
          name="time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Time</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((option: Field) => (
                      <SelectItem key={option.name} value={option.name}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              {errors.time && (
                <p className="text-red-500 text-sm">{errors.time.message}</p>
              )}
            </FormItem>
          )}
        />

        {/* Optionally, include an Altitude field if needed */}
        {/* <FormField
          control={control}
          name="altitude"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Altitude</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((option: Field) => (
                      <SelectItem key={option.name} value={option.name}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              {errors.altitude && (
                <p className="text-red-500 text-sm">{errors.altitude.message}</p>
              )}
            </FormItem>
          )}
        /> */}

        <div className="space-y-4 mt-4">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="visualizeActivitySpace"
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              onChange={(e) => {
                form.setValue('visualizeActivitySpace', e.target.checked);
              }}
            />
            <label htmlFor="visualizeActivitySpace" className="text-sm font-medium">
              Visualize Activity Space
            </label>
          </div>

          {form.watch('visualizeActivitySpace') && (
            <>
              <FormField
                control={control}
                name="activitySpaceField"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Activity Space Field</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select field to distinguish activity spaces" />
                        </SelectTrigger>
                        <SelectContent>
                          {fields.map((option: Field) => (
                            <SelectItem key={option.name} value={option.name}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="activitySpaceValues"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Activity Space Values</FormLabel>
                    <FormControl>
                      <Controller
                        name="activitySpaceValues"
                        control={control}
                        render={({ field }) => {
                          const selectedField = form.watch('activitySpaceField');
                          const uniqueValues = getUniqueValuesFromGeoJSON(rawGeoData, selectedField || '');
                          const uniqueValuesOptions: Option[] = uniqueValues.map(value => ({
                            value: String(value),
                            label: String(value)
                          }));
                          
                          
                          // Transform string values to Option objects for MultipleSelector
                          
                          return (
                            <MultipleSelector
                              {...field}
                              options={uniqueValuesOptions}
                              placeholder="Select values that represent activity spaces"
                              emptyIndicator={
                                <p className="text-center text-sm text-muted-foreground">
                                  No values found.
                                </p>
                              }
                            />
                          );
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </>
          )}
        </div>
        <Button type="submit" className="w-full bg-blue-500 text-white">Confirm</Button>
      </form>
    </Form>
  );
};

export default FileForm;
