inicar servidor;

venv\Scripts\activate #activamos el entorno virtual

cd backend 


python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   



landing 

Entramos a el front 

cd front 

deactivate #desactivamos el entorno virtual en la carpeta front

 
$env:Path = "C:\Program Files\nodejs;C:\Users\DiegoArbeláez\AppData\Roaming\npm;" + $env:Path #agremos node en el path 


npm run dev 