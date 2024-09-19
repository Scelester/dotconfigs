precision highp float;
varying vec2 v_texcoord;
uniform sampler2D tex;

// Brightness and contrast parameters
uniform float brightness = 0.0;
uniform float contrast = 1.0;

void main() {
    vec4 pixColor = texture2D(tex, v_texcoord);

    // Adjust contrast
    vec3 contrastColor = (pixColor.rgb - 0.5) * contrast + 0.5;
    // Adjust brightness
    vec3 brightColor = contrastColor + brightness;

    gl_FragColor = vec4(clamp(brightColor, 0.0, 1.0), pixColor.a);
}
