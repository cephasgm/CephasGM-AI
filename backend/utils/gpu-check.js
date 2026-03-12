// GPU availability checker for Render deployment
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function checkGpuAvailability() {
  // Check if we're on Render (you can also use process.env.RENDER === 'true')
  const isRender = process.env.RENDER === 'true' || process.env.IS_RENDER === 'true';
  
  if (isRender) {
    console.log('Running on Render - GPU not available, using CPU fallback');
    return false;
  }
  
  try {
    const { stdout } = await execPromise('nvidia-smi');
    const hasGPU = stdout.includes('NVIDIA-SMI');
    console.log(`GPU ${hasGPU ? 'available' : 'not available'}`);
    return hasGPU;
  } catch (error) {
    console.log('GPU not available, using CPU fallback');
    return false;
  }
}

module.exports = { checkGpuAvailability };
