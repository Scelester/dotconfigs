precision highp float;
varying vec2 v_texcoord;
uniform sampler2D tex;

// Blur size
uniform float blurSize = 1.0;

void main() {
    vec4 color = vec4(0.0);
    vec2 offset = blurSize / 512.0; // Assuming 512 is your texture resolution, adjust as needed

    for (float x = -1.0; x <= 1.0; x += 1.0) {
        for (float y = -1.0; y <= 1.0; y += 1.0) {
            color += texture2D(tex, v_texcoord + vec2(x, y) * offset);
        }
    }
    
    color /= 9.0; // Number of samples
    gl_FragColor = color;
}
