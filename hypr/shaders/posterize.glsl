precision highp float;
varying vec2 v_texcoord;
uniform sampler2D tex;

// Number of color levels
uniform int levels = 4;

void main() {
    vec4 pixColor = texture2D(tex, v_texcoord);

    vec3 color = pixColor.rgb;
    float stepSize = 1.0 / float(levels);

    color = floor(color / stepSize) * stepSize;

    gl_FragColor = vec4(color, pixColor.a);
}
