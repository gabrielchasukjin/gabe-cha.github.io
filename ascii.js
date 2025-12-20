// Wave Interference Animation with timed popping dots

const canvas = document.getElementById('ascii-canvas');
const ctx = canvas.getContext('2d');
const width = 550;
const height = 550;
canvas.width = width;
canvas.height = height;

// Points of origin from which patterns emerge
const sources = [];
const gridSize = 4;

for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
        sources.push({
            x: width * (i + 0.5) / gridSize,
            y: height * (j + 0.5) / gridSize,
            wavelength: 15 + Math.random() * 10,
            phase: Math.random() * Math.PI * 2
        });
    }
}

// Dynamic dots that spawn and fade
let dots = [];

function spawnDot() {
    dots.push({
        x: Math.random() * width,
        y: Math.random() * height,
        color: Math.random() > 0.5 ? '#0d9488' : '#f97316',
        radius: 2 + Math.random() * 2,
        life: 1.0,
        decay: 0.005 + Math.random() * 0.01
    });
}

// Spawn initial dots
for (let i = 0; i < 30; i++) {
    spawnDot();
    dots[i].life = Math.random();
}

let time = 0;

function animate() {
    // Fill with background color
    ctx.fillStyle = '#F0EEE6';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;

    // Sample points for marching squares algorithm
    const resolution = 2;
    const rows = Math.floor(height / resolution);
    const cols = Math.floor(width / resolution);
    const field = new Array(rows).fill(0).map(() => new Array(cols).fill(0));

    // Calculate wave field
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const x = j * resolution;
            const y = i * resolution;
            let amplitude = 0;

            sources.forEach(source => {
                const dx = x - source.x;
                const dy = y - source.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                amplitude += Math.sin((distance / source.wavelength - time) * 2 * Math.PI + source.phase);
            });

            field[i][j] = amplitude / sources.length;
        }
    }

    // Draw contour lines using marching squares
    const contourLevels = [-0.6, -0.3, 0, 0.3, 0.6];

    contourLevels.forEach(level => {
        ctx.beginPath();

        for (let i = 0; i < rows - 1; i++) {
            for (let j = 0; j < cols - 1; j++) {
                const x = j * resolution;
                const y = i * resolution;

                const case4 =
                    (field[i][j] > level ? 8 : 0) +
                    (field[i][j + 1] > level ? 4 : 0) +
                    (field[i + 1][j + 1] > level ? 2 : 0) +
                    (field[i + 1][j] > level ? 1 : 0);

                switch (case4) {
                    case 1: case 14:
                        ctx.moveTo(x, y + resolution / 2);
                        ctx.lineTo(x + resolution / 2, y + resolution);
                        break;
                    case 2: case 13:
                        ctx.moveTo(x + resolution / 2, y + resolution);
                        ctx.lineTo(x + resolution, y + resolution / 2);
                        break;
                    case 3: case 12:
                        ctx.moveTo(x, y + resolution / 2);
                        ctx.lineTo(x + resolution, y + resolution / 2);
                        break;
                    case 4: case 11:
                        ctx.moveTo(x + resolution, y + resolution / 2);
                        ctx.lineTo(x + resolution / 2, y);
                        break;
                    case 5: case 10:
                        ctx.moveTo(x, y + resolution / 2);
                        ctx.lineTo(x + resolution / 2, y);
                        ctx.moveTo(x + resolution, y + resolution / 2);
                        ctx.lineTo(x + resolution / 2, y + resolution);
                        break;
                    case 6: case 9:
                        ctx.moveTo(x + resolution / 2, y);
                        ctx.lineTo(x + resolution / 2, y + resolution);
                        break;
                    case 7: case 8:
                        ctx.moveTo(x, y + resolution / 2);
                        ctx.lineTo(x + resolution / 2, y);
                        break;
                }
            }
        }

        ctx.stroke();
    });

    // Update and draw dots
    dots.forEach(dot => {
        dot.life -= dot.decay;
        
        if (dot.life > 0) {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dot.radius * dot.life, 0, Math.PI * 2);
            ctx.fillStyle = dot.color;
            ctx.globalAlpha = dot.life;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    });

    // Remove dead dots and spawn new ones
    dots = dots.filter(dot => dot.life > 0);
    
    // Randomly spawn new dots
    if (Math.random() < 0.15) {
        spawnDot();
    }

    time += 0.003;
    requestAnimationFrame(animate);
}

animate();
