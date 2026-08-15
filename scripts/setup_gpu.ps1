# Install a CUDA 3DGS training environment next to the viewer.
# Needs: NVIDIA driver (this machine has a 5070 Ti), uv, and ~4 GB disk.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Installing Python 3.12 + PyTorch CUDA + gsplat into .venv-gpu"
uv python install 3.12
if (Test-Path ".venv-gpu") { Remove-Item -Recurse -Force ".venv-gpu" }
uv venv --python 3.12 .venv-gpu
$py = Join-Path $Root ".venv-gpu\Scripts\python.exe"

# Blackwell (50-series) needs a recent CUDA wheel. cu128 is the current stable index.
& $py -m pip install --upgrade pip
& $py -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
& $py -m pip install gsplat numpy pillow

Write-Host ""
& $py -c "import torch, gsplat; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')"
Write-Host ""
Write-Host "COLMAP is still required for camera poses."
Write-Host "Install the CUDA Windows build from https://github.com/colmap/colmap/releases"
Write-Host "and make sure 'colmap' is on PATH, then upload a phone clip from the viewer."
