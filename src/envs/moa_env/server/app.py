"""FastAPI server for MOA environment."""

from core.env_server import create_app
from ..models import MOAAction, MOAObservation
from ..moa_env import MOAEnv

env = MOAEnv()
app = create_app(env, MOAAction, MOAObservation, env_name="moa_env")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
