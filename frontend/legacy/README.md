# Legacy prototype UI (not built)

These files are the pre-presentation prototype: the multi-vineyard chooser/create/delete
flow, the image-overlay vineyard designer, the synthetic Sonoma `CRS.Simple` map with its
"Drone coverage" layer, and the old Sonoma mock data. (The CSV/XLSX importer moved to `src/features/data-import/`.) They are kept only for reference and
are **outside `src/`, so they are not type-checked or bundled**. Delete this folder once
nothing here is needed. The backend layout/vineyard endpoints they called still exist in
`backend/app/routes/imports.py`.
