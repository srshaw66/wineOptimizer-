"""Example adapter: CSV with columns plant_id,date,coverage,status."""
import csv
from io import StringIO
class CSVAdapter:
    def validate(self,payload:str)->None:
        rows=csv.DictReader(StringIO(payload))
        if not {'plant_id','date','coverage','status'}.issubset(rows.fieldnames or []):
            raise ValueError('Missing required CSV columns')
    def normalize(self,payload:str)->list[dict]:
        self.validate(payload)
        return [dict(plantId=row['plant_id'],date=row['date'],coverage=float(row['coverage']),status=row['status']) for row in csv.DictReader(StringIO(payload))]
